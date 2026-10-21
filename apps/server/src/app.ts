import type { AccountContext } from '@notaflow/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Dispatcher } from 'undici';
import { type ExchangeRateSource, ptaxSource } from './exchange/ptax';
import { registerAuth } from './auth/authHook';
import { registerAuthRoutes } from './auth/authRoutes';
import { BugReports } from './bugs/BugReports';
import { bugChannelClients } from './bugs/channels';
import { registerGithubWebhook } from './bugs/githubWebhook';
import { r2Client } from './bugs/r2';
import { type Auth, createAuth } from './auth/betterAuth';
import { consoleMailer, type Mailer, resendMailer } from './mail/mailer';
import { MailOutbox } from './mail/outbox';
import type { Config } from './config';
import type { Database } from './db/openDatabase';
import { handleError } from './httpError';
import { IssueService } from './issue/IssueService';
import {
  type IssuerFactory,
  nacionalIssuerFactory,
  nacionalProviderFactory,
  type ProviderFactory,
} from './providers/providerFactory';
import { CertificateRepository } from './repos/CertificateRepository';
import { IdentityRepository } from './repos/IdentityRepository';
import { adminRoutes } from './routes/admin';
import { auditRoutes } from './routes/audit';
import { bugReportRoutes } from './routes/bugReports';
import { customerRoutes } from './routes/customers';
import { clientIp, requestContext } from './requestContext';
import { cepRoutes } from './routes/cep';
import { fiscalRoutes } from './routes/fiscal';
import { serviceRoutes } from './routes/services';
import { serviceSuggestionRoutes } from './routes/serviceSuggestions';
import { emitterRoutes } from './routes/emitters';
import { invoiceRoutes } from './routes/invoices';
import { issueRoutes } from './routes/issue';
import { LIFECYCLE_LEGAL_VERSION, POLICY_NOTICE, type PolicyNotice } from './legal';
import { LifecycleService } from './lifecycle/LifecycleService';
import { registerUnsubscribe, unsubscribeUrl } from './lifecycle/unsubscribe';
import { AuditLog } from './repos/AuditLog';
import { lifecycleEmail } from './mail/templates';
import { LifecycleRepository } from './repos/LifecycleRepository';
import { meRoutes } from './routes/me';
import { publicConfigRoutes } from './routes/publicConfig';
import { adminMailRoutes } from './routes/adminMail';
import { memberRoutes } from './routes/members';
import { onboardingRoutes } from './routes/onboarding';
import { EmitterOnboarding } from './emitters/EmitterOnboarding';
import { syncRoutes } from './routes/sync';
import { SyncService } from './sync/SyncService';
import { VaultCertificateStore } from './vault/VaultCertificateStore';
import { Metrics, moduleOf } from './metrics/metrics';
import {
  type ErrorReporter,
  noErrorReporter,
  sentryReporter,
  statusOf,
} from './observability/errors';
import { MetricsRepository } from './repos/MetricsRepository';
import { registerSecurityHeaders } from './securityHeaders';
import { isApiPath, registerWeb } from './web';

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
    syncService: SyncService;
    metrics: Metrics;
    lifecycle: LifecycleService;
    mailOutbox: MailOutbox;
    bugReports: BugReports;
    auth: Auth;
  }
}

export interface AppDeps {
  // Tests inject a notice; production uses POLICY_NOTICE.
  policyNotice?: PolicyNotice | null;
  config: Config;
  db: Database;
  logStream?: { write(line: string): void };
  providerFactory?: ProviderFactory;
  issuerFactory?: IssuerFactory;
  exchangeRate?: ExchangeRateSource;
  cepDispatcher?: Dispatcher;
  // GitHub, Discord, Notion, and the R2 screenshot bucket for bug reports; tests pass a MockAgent.
  bugDispatcher?: Dispatcher;
  cnpjDispatcher?: Dispatcher;
  ptaxDispatcher?: Dispatcher;
  syncService?: SyncService;
  syncRetryDelaysMs?: number[];
  onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void;
  webRoot?: string;
  mailer?: Mailer;
  auth?: Auth;
  errorReporter?: ErrorReporter;
}

// Fastify's request fields, but an auth callback's query (a one-time Google code) stays out of the log.
function requestForLog(request: {
  method: string;
  url: string;
  host: string;
  ip: string;
  socket: { remotePort?: number | undefined };
}) {
  const url = request.url.startsWith('/api/auth/callback/')
    ? (request.url.split('?')[0] ?? '')
    : request.url;
  return {
    method: request.method,
    url,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort ?? 0,
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const serializers = { req: requestForLog };
  const app = Fastify({
    logger: deps.logStream
      ? { stream: deps.logStream, serializers }
      : config.nodeEnv === 'test'
        ? false
        : { serializers },
  });
  const routeList: { method: string; url: string }[] = [];
  app.decorate('routeList', routeList);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routeList.push({ method, url: route.url });
    }
  });
  app.addHook('onRequest', (request, _reply, done) => {
    const cf = request.headers['cf-connecting-ip'];
    const info = {
      ip: clientIp(
        request.socket.remoteAddress ?? request.ip,
        typeof cf === 'string' ? cf : undefined,
        config.trustCloudflareIp,
      ),
      userAgent: request.headers['user-agent'] ?? null,
      requestId: request.id,
    };
    // run, not enterWith: the data must not outlive the request in the caller's context.
    requestContext.run(info, done);
  });
  app.setErrorHandler(handleError);
  const reporter =
    deps.errorReporter ??
    (config.sentry.serverDsn
      ? sentryReporter({
          dsn: config.sentry.serverDsn,
          release: config.sentry.release ?? undefined,
          environment: config.nodeEnv,
        })
      : noErrorReporter);
  // Only server faults: a 4xx is the client's mistake and would bury the real errors.
  app.addHook('onError', async (request, _reply, error) => {
    if (statusOf(error) >= 500) {
      reporter.capture(error, { module: routeModule(request), requestId: request.id });
    }
  });

  const transport =
    deps.mailer ??
    (config.mail.resendApiKey
      ? resendMailer({ apiKey: config.mail.resendApiKey, from: config.mail.from })
      : consoleMailer((line) => app.log.info(line)));
  // Every e-mail goes through the outbox: a failed send is retried, and the last failure is kept.
  const outbox = new MailOutbox(db, transport, (line) => app.log.error(line));
  app.decorate('mailOutbox', outbox);
  const lifecycleRepo = new LifecycleRepository(db, LIFECYCLE_LEGAL_VERSION);
  app.decorate(
    'lifecycle',
    new LifecycleService({
      repo: lifecycleRepo,
      outbox,
      startAt: config.lifecycleStartAt,
      render: lifecycleEmail,
      unsubscribeUrl: (userId) => unsubscribeUrl(config.appOrigin, userId, config.authSecret),
    }),
  );
  registerUnsubscribe(app, {
    repo: lifecycleRepo,
    outbox,
    audit: new AuditLog(db),
    secret: config.authSecret,
  });
  const bugs = new BugReports({
    db,
    clients: bugChannelClients(config.bugs, deps.bugDispatcher),
    on: {
      github: config.bugs.github !== null,
      discord: config.bugs.discordWebhookUrl !== null,
      notion: config.bugs.notion !== null,
    },
    r2: config.bugs.r2 ? r2Client(config.bugs.r2, deps.bugDispatcher) : null,
    appOrigin: config.appOrigin,
    logError: (line) => app.log.error(line),
  });
  app.decorate('bugReports', bugs);
  // A delivery started by a request must not outlive the database.
  app.addHook('onClose', () => bugs.idle());
  registerGithubWebhook(app, {
    secret: config.bugs.githubWebhookSecret,
    repo: config.bugs.github?.repo ?? null,
    bugs,
    audit: new AuditLog(db),
  });
  const mailer = outbox.mailer();
  const auth = deps.auth ?? createAuth({ config, db, mailer, log: (line) => app.log.warn(line) });
  app.decorate('auth', auth);
  registerAuth(app, { config, identities: new IdentityRepository(db), auth });
  registerAuthRoutes(app, auth, config.appOrigin);

  const metrics = new Metrics(new MetricsRepository(db, config.databasePath));
  app.decorate('metrics', metrics);
  app.addHook('onRequest', async (request, reply) => {
    // Fastify writes "request completed" through reply.log, a separate reference.
    request.log = request.log.child({ module: routeModule(request) });
    reply.log = request.log;
  });
  app.addHook('onResponse', async (request, reply) => {
    metrics.request(
      routeModule(request),
      request.method,
      reply.statusCode,
      reply.elapsedTime / 1000,
    );
  });

  const providerFactory = deps.providerFactory ?? nacionalProviderFactory(config.nacionalUrls);
  const certificates = new VaultCertificateStore(new CertificateRepository(db), config.masterKey);
  const syncService =
    deps.syncService ??
    new SyncService({
      db,
      certificates,
      providerFactory,
      onRun: (emitterId, error, at) => metrics.syncRun(emitterId, error, at),
      ...(deps.syncRetryDelaysMs ? { retryDelaysMs: deps.syncRetryDelaysMs } : {}),
    });
  app.decorate('syncService', syncService);
  const onEmitterCreated =
    deps.onEmitterCreated ??
    ((ctx: AccountContext, emitterId: string) => {
      syncService
        .syncEmitter(ctx, emitterId)
        .then((result) => app.log.info({ emitterId, ...result }, 'first sync finished'))
        .catch((error: unknown) => app.log.warn({ emitterId, err: error }, 'first sync failed'));
    });

  app.get('/api/health', async () => ({ status: 'ok' }));
  publicConfigRoutes(app, config);
  meRoutes(app, db, deps.policyNotice === undefined ? POLICY_NOTICE : deps.policyNotice);
  adminRoutes(app, db);
  memberRoutes(app, { db, outbox, appOrigin: config.appOrigin });
  adminMailRoutes(app, { db, outbox });
  onboardingRoutes(app, {
    db,
    emitterOnboarding: new EmitterOnboarding({
      db,
      masterKey: config.masterKey,
      providerFactory,
      onEmitterCreated,
    }),
    ...(deps.cnpjDispatcher ? { cnpjDispatcher: deps.cnpjDispatcher } : {}),
  });
  emitterRoutes(app, { db, masterKey: config.masterKey, providerFactory, onEmitterCreated });
  syncRoutes(app, { db, sync: syncService });
  invoiceRoutes(app, { db, masterKey: config.masterKey, providerFactory });
  const issue = new IssueService({
    db,
    certificates,
    issuerFactory: deps.issuerFactory ?? nacionalIssuerFactory(config.nacionalUrls),
    exchangeRate: deps.exchangeRate ?? ptaxSource(deps.ptaxDispatcher),
  });
  issueRoutes(app, {
    issue,
    ...(deps.ptaxDispatcher ? { ptaxDispatcher: deps.ptaxDispatcher } : {}),
  });
  customerRoutes(app, db);
  fiscalRoutes(app, db);
  cepRoutes(app, deps.cepDispatcher ? { cepDispatcher: deps.cepDispatcher } : {});
  serviceRoutes(app, db);
  serviceSuggestionRoutes(app, {
    db,
    ...(deps.cnpjDispatcher ? { cnpjDispatcher: deps.cnpjDispatcher } : {}),
  });
  auditRoutes(app, db);
  bugReportRoutes(app, { db, bugs });
  registerSecurityHeaders(app, {
    appOrigin: config.appOrigin,
    posthogHost: config.posthog?.host ?? null,
    sentryDsn: config.sentry.webDsn,
    webRoot: deps.webRoot,
  });
  if (deps.webRoot) registerWeb(app, deps.webRoot, config.appOrigin);
  return app;
}

// The route pattern keeps the label set small; a request with no route (a 404) is the web app or the API by path.
function routeModule(request: FastifyRequest) {
  return moduleOf(request.routeOptions.url ?? (isApiPath(request.url) ? '/api/' : '/'));
}
