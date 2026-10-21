import type { AccountContext } from '@notaflow/core';
import { type FakeNacional, startFakeNacional } from '@notaflow/fake-nacional';
import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import type { ExchangeRateSource } from '../src/exchange/ptax';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { type AuthDeps, createAuth } from '../src/auth/betterAuth';
import type { MailMessage } from '../src/mail/mailer';
import type { PolicyNotice } from '../src/legal';
import { users } from '../src/db/schema';
import { nacionalIssuerFactory } from '../src/providers/providerFactory';
import { loadConfig } from '../src/config';
import { type Database, openDatabase } from '../src/db/openDatabase';

export const ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  fake: FakeNacional;
  // Every e-mail the app sent, in order.
  mail: MailMessage[];
  cookieFor(email: string): Promise<string>;
  as(email: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export async function createTestApp(
  options: {
    logStream?: { write(line: string): void };
    onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void;
    ptaxDispatcher?: Dispatcher;
    exchangeRate?: ExchangeRateSource;
    cepDispatcher?: Dispatcher;
    bugDispatcher?: Dispatcher;
    cnpjDispatcher?: Dispatcher;
    env?: Record<string, string>;
    googleUserInfo?: AuthDeps['googleUserInfo'];
    // The app's e-mails fail, as when Resend is down; Better Auth's codes still arrive.
    failMail?: boolean;
    policyNotice?: PolicyNotice | null;
  } = {},
): Promise<TestApp> {
  const fake = await startFakeNacional();
  const { db, close } = openDatabase(':memory:');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: ORIGIN,
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
    SIGNUP_OPEN: 'true',
    NACIONAL_FAKE_URL: fake.urls.sefin.replace('/SefinNacional', ''),
    ...options.env,
  });
  const mail: MailMessage[] = [];
  const mailer = async (message: MailMessage) => {
    mail.push(message);
  };
  const auth = createAuth({
    config,
    db,
    mailer,
    testUtils: true,
    ...(options.googleUserInfo ? { googleUserInfo: options.googleUserInfo } : {}),
  });
  const app = buildApp({
    config,
    db,
    mailer: options.failMail
      ? async () => {
          throw new Error('Resend answered 503');
        }
      : mailer,
    auth,
    ...(options.logStream ? { logStream: options.logStream } : {}),
    ...(options.policyNotice !== undefined ? { policyNotice: options.policyNotice } : {}),
    ...(options.ptaxDispatcher ? { ptaxDispatcher: options.ptaxDispatcher } : {}),
    ...(options.cepDispatcher ? { cepDispatcher: options.cepDispatcher } : {}),
    ...(options.bugDispatcher ? { bugDispatcher: options.bugDispatcher } : {}),
    ...(options.cnpjDispatcher ? { cnpjDispatcher: options.cnpjDispatcher } : {}),
    // A fixed PTAX of 5.0000 unless a test brings its own; the real one is a network call.
    exchangeRate:
      options.exchangeRate ??
      (async (currency, date) => ({
        currency,
        date,
        rateE4: 50_000,
        source: 'PTAX venda, fechamento',
      })),
    // Tests sync explicitly; a background sync could outlive the in-memory database.
    onEmitterCreated: options.onEmitterCreated ?? (() => {}),
    // Production waits 1, 5, and 15 seconds; a test would hit its own timeout.
    syncRetryDelaysMs: [0, 0],
    // A short Sefin timeout, so the fake's delay scenario turns into an uncertain result.
    issuerFactory: nacionalIssuerFactory(config.nacionalUrls, 300),
  });
  await app.ready();

  // A real signed session cookie without the login flow (test-utils plugin), one per e-mail.
  const cookies = new Map<string, string>();
  const cookieFor = async (email: string) => {
    const cached = cookies.get(email.toLowerCase());
    if (cached) return cached;
    const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    if (!user) throw new Error(`No user ${email}; seed it first.`);
    const context = (await auth.$context) as unknown as {
      test: { getAuthHeaders(opts: { userId: string }): Promise<Headers> };
    };
    const headers = await context.test.getAuthHeaders({ userId: user.id });
    const cookie = headers.get('cookie') ?? '';
    cookies.set(email.toLowerCase(), cookie);
    return cookie;
  };

  return {
    app,
    db,
    fake,
    mail,
    cookieFor,
    as: async (email) => ({
      cookie: await cookieFor(email),
      origin: ORIGIN,
      'content-type': 'application/json',
    }),
    close: async () => {
      await app.close();
      close();
      await fake.close();
    },
  };
}
