import type { AccountContext } from '@notaflow/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { type ExchangeRateSource, ptaxSource } from './exchange/ptax';
import { remoteAccessVerifier, type VerifyAccessToken } from './auth/accessVerifier';
import { registerAuth } from './auth/authHook';
import { registerAuthRoutes } from './auth/authRoutes';
import { type Auth, createAuth } from './auth/betterAuth';
import { consoleMailer, type Mailer, resendMailer } from './mail/mailer';
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
import { customerRoutes } from './routes/customers';
import { clientIp, requestContext } from './requestContext';
import { cepRoutes } from './routes/cep';
import { fiscalRoutes } from './routes/fiscal';
import { serviceRoutes } from './routes/services';
import { emitterRoutes } from './routes/emitters';
import { invoiceRoutes } from './routes/invoices';
import { issueRoutes } from './routes/issue';
import { meRoutes } from './routes/me';
import { memberRoutes } from './routes/members';
import { syncRoutes } from './routes/sync';
import { SyncService } from './sync/SyncService';
import { VaultCertificateStore } from './vault/VaultCertificateStore';
import { registerWeb } from './web';

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
    syncService: SyncService;
    auth: Auth;
  }
}

export interface AppDeps {
  config: Config;
  db: Database;
  verifyAccessToken?: VerifyAccessToken;
  logStream?: { write(line: string): void };
  providerFactory?: ProviderFactory;
  issuerFactory?: IssuerFactory;
  exchangeRate?: ExchangeRateSource;
  cepDispatcher?: Dispatcher;
  ptaxDispatcher?: Dispatcher;
  syncService?: SyncService;
  syncRetryDelaysMs?: number[];
  onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void;
  webRoot?: string;
  mailer?: Mailer;
  auth?: Auth;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const app = Fastify({
    logger: deps.logStream ? { stream: deps.logStream } : config.nodeEnv !== 'test',
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
      ),
      userAgent: request.headers['user-agent'] ?? null,
      requestId: request.id,
    };
    // run, not enterWith: the data must not outlive the request in the caller's context.
    requestContext.run(info, done);
  });
  app.setErrorHandler(handleError);

  const verifyAccessToken =
    deps.verifyAccessToken ??
    (config.auth.mode === 'access'
      ? remoteAccessVerifier(config.auth.teamDomain, config.auth.audience)
      : async () => '');
  registerAuth(app, { config, identities: new IdentityRepository(db), verifyAccessToken });
  const mailer =
    deps.mailer ??
    (config.mail.resendApiKey
      ? resendMailer({ apiKey: config.mail.resendApiKey, from: config.mail.from })
      : consoleMailer((line) => app.log.info(line)));
  const auth =
    deps.auth ?? createAuth({ config, db, mailer, log: (line) => app.log.warn(line) });
  app.decorate('auth', auth);
  registerAuthRoutes(app, auth, config.appOrigin);

  const providerFactory = deps.providerFactory ?? nacionalProviderFactory(config.nacionalUrls);
  const certificates = new VaultCertificateStore(new CertificateRepository(db), config.masterKey);
  const syncService =
    deps.syncService ??
    new SyncService({
      db,
      certificates,
      providerFactory,
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
  meRoutes(app);
  adminRoutes(app, db);
  memberRoutes(app, db);
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
  auditRoutes(app, db);
  if (deps.webRoot) registerWeb(app, deps.webRoot);
  return app;
}
