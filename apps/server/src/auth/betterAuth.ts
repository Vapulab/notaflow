import { randomUUID } from 'node:crypto';
import { passkey } from '@better-auth/passkey';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { GoogleOptions } from 'better-auth/social-providers';
import { APIError } from 'better-auth/api';
import { captcha, emailOTP, haveIBeenPwned, testUtils } from 'better-auth/plugins';
import { and, count, eq, gte, isNotNull } from 'drizzle-orm';
import type { Config } from '../config';
import type { Database } from '../db/openDatabase';
import {
  auditLog,
  authAccounts,
  authPasskeys,
  authSessions,
  authVerifications,
  mailOutbox,
  users,
} from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { codeEmail, existingAccountEmail, welcomeEmail } from '../mail/templates';
import { AuditLog } from '../repos/AuditLog';
import { authAuditHooks, recordGoogleLinked } from './authAudit';
import { requestContext } from '../requestContext';

// The server sets it from the request context on every call; a client's own value is dropped.
export const CLIENT_IP_HEADER = 'x-notaflow-client-ip';

export interface AuthDeps {
  config: Config;
  db: Database;
  mailer: Mailer;
  // Tests only: adds the test-utils plugin (sessions without a login flow).
  testUtils?: boolean;
  // Tests only: Google's profile, instead of reading it from the ID token.
  googleUserInfo?: GoogleOptions['getUserInfo'];
  log?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function refuse(status: 'FORBIDDEN' | 'TOO_MANY_REQUESTS', code: string): APIError {
  return new APIError(status, { code, message: code });
}

export function createAuth(deps: AuthDeps) {
  const { config, db, mailer } = deps;
  const audit = new AuditLog(db);

  // Signups in flight per IP: the audit row is written after the user, so parallel requests reserve first.
  const reserved = new Map<string, number[]>();
  const reservationsOf = (ip: string) => {
    const live = (reserved.get(ip) ?? []).filter((at) => at > Date.now() - 60_000);
    reserved.set(ip, live);
    return live;
  };

  // A new user only when signup is open, and at most N per IP per day (counted in the audit log).
  const beforeUserCreate = async () => {
    if (!config.signup.open) throw refuse('FORBIDDEN', 'signup_closed');
    const ip = requestContext.getStore()?.ip;
    if (!ip) return;
    const inFlight = reservationsOf(ip);
    const row = db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'auth.signup'),
          eq(auditLog.result, 'ok'),
          eq(auditLog.ip, ip),
          gte(auditLog.at, new Date(Date.now() - DAY_MS)),
        ),
      )
      .get();
    if ((row?.n ?? 0) + inFlight.length >= config.signup.limitPerIpPerDay) {
      throw refuse('TOO_MANY_REQUESTS', 'signup_limit');
    }
    inFlight.push(Date.now());
  };

  // Only a confirmed address gets it: a typo would bounce, and bounces hurt the sender's reputation.
  const welcomed = (email: string) =>
    db
      .select({ id: mailOutbox.id })
      .from(mailOutbox)
      .where(and(eq(mailOutbox.to, email), eq(mailOutbox.kind, 'welcome')))
      .get() !== undefined;
  const sendWelcome = (user: { email: string; name: string }) => {
    if (welcomed(user.email)) return;
    // Not awaited: a slow or failed welcome e-mail must not fail the signup.
    mailer({ to: user.email, kind: 'welcome', ...welcomeEmail(user.name) }).catch(
      (error: unknown) => deps.log?.(`welcome e-mail failed: ${String(error)}`),
    );
  };
  // Requests that set email_verified; the update's after hook does not see what changed.
  const verifying = new WeakSet<object>();

  // Better Auth finds users by e-mail without deleted_at, so a removed user is stopped here.
  const beforeSessionCreate = async (session: { userId: string }) => {
    const removed = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, session.userId), isNotNull(users.deletedAt)))
      .get();
    if (removed) throw refuse('FORBIDDEN', 'account_removed');
  };

  const codeLogin = emailOTP({
    otpLength: 6,
    expiresIn: 600,
    allowedAttempts: 5,
    storeOTP: 'hashed',
    sendVerificationOnSignUp: true,
    overrideDefaultEmailVerification: true,
    async sendVerificationOTP({ email, otp, type }) {
      if (type === 'change-email') throw refuse('FORBIDDEN', 'not_supported');
      try {
        await mailer({ to: email, kind: 'code', ...codeEmail(type, otp) });
      } catch (error) {
        deps.log?.(`code e-mail to @${email.split('@')[1] ?? ''} failed: ${String(error)}`);
        throw error;
      }
    },
  });

  return betterAuth({
    appName: 'NotaFlow',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appOrigin],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { users, authSessions, authAccounts, authVerifications, authPasskeys },
    }),
    user: { modelName: 'users' },
    session: {
      modelName: 'authSessions',
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: 'authAccounts',
      // Google links to an existing user only when Google says the e-mail is verified.
      accountLinking: { enabled: true, trustedProviders: [] },
    },
    ...(config.google
      ? {
          socialProviders: {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              ...(deps.googleUserInfo ? { getUserInfo: deps.googleUserInfo } : {}),
            },
          },
        }
      : {}),
    hooks: authAuditHooks(db, audit, { signupOpen: config.signup.open }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      // The generic answer keeps the e-mail private; the owner learns of the attempt by e-mail.
      onExistingUserSignUp: async ({ user }) => {
        await mailer({ to: user.email, kind: 'notice', ...existingAccountEmail() });
      },
    },
    emailVerification: { autoSignInAfterVerification: true },
    verification: { modelName: 'authVerifications' },
    disabledPaths: [
      '/delete-user',
      '/delete-user/callback',
      '/change-email',
      '/email-otp/change-email',
      '/email-otp/request-email-change',
    ],
    rateLimit: { enabled: true, storage: 'memory' },
    advanced: {
      cookiePrefix: 'notaflow',
      // Better Auth skips its origin check when NODE_ENV is test; tests must see production behavior.
      disableOriginCheck: false,
      useSecureCookies: config.appOrigin.startsWith('https://'),
      database: { generateId: () => randomUUID() },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            await beforeUserCreate();
          },
          after: async (user) => {
            const ip = requestContext.getStore()?.ip;
            if (ip) reservationsOf(ip).shift();
            if (user.emailVerified) sendWelcome(user);
            audit.record({
              userEmail: user.email,
              accountId: null,
              action: 'auth.signup',
              entity: user.id,
              result: 'ok',
            });
          },
        },
        update: {
          before: async (data) => {
            const store = requestContext.getStore();
            if (store && data.emailVerified === true) verifying.add(store);
          },
          after: async (user) => {
            const store = requestContext.getStore();
            if (store && verifying.has(store) && user.emailVerified) sendWelcome(user);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            await beforeSessionCreate(session);
          },
        },
      },
      account: {
        create: {
          after: async (account) => {
            recordGoogleLinked(db, audit, account);
          },
        },
      },
    },
    plugins: [
      codeLogin,
      passkey({
        rpID: new URL(config.appOrigin).hostname,
        rpName: 'NotaFlow',
        origin: config.appOrigin,
        schema: { passkey: { modelName: 'authPasskeys' } },
      }),
      haveIBeenPwned({
        customPasswordCompromisedMessage:
          'Esta senha apareceu em vazamentos conhecidos. Escolha outra.',
      }),
      ...(config.turnstile
        ? [
            captcha({
              provider: 'cloudflare-turnstile',
              secretKey: config.turnstile.secretKey,
              endpoints: [
                '/sign-up/email',
                '/email-otp/send-verification-otp',
                '/email-otp/request-password-reset',
                '/forget-password/email-otp',
              ],
            }),
          ]
        : []),
      // The cast covers a typing gap of test-utils under exactOptionalPropertyTypes.
      ...(deps.testUtils ? [testUtils() as BetterAuthPlugin] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
