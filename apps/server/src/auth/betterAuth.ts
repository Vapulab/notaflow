import { randomUUID } from 'node:crypto';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { emailOTP, testUtils } from 'better-auth/plugins';
import { and, count, eq, gte, isNotNull } from 'drizzle-orm';
import type { Config } from '../config';
import type { Database } from '../db/openDatabase';
import {
  auditLog,
  authAccounts,
  authPasskeys,
  authSessions,
  authVerifications,
  users,
} from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { codeEmail } from '../mail/templates';
import { AuditLog } from '../repos/AuditLog';
import { requestContext } from '../requestContext';

// The server sets it from the request context on every call; a client's own value is dropped.
export const CLIENT_IP_HEADER = 'x-notaflow-client-ip';

export interface AuthDeps {
  config: Config;
  db: Database;
  mailer: Mailer;
  // Tests only: adds the test-utils plugin (sessions without a login flow).
  testUtils?: boolean;
  log?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function refuse(status: 'FORBIDDEN' | 'TOO_MANY_REQUESTS', code: string): APIError {
  return new APIError(status, { code, message: code });
}

export function createAuth(deps: AuthDeps) {
  const { config, db, mailer } = deps;
  const audit = new AuditLog(db);

  // A new user only when signup is open, and at most N per IP per day (counted in the audit log).
  const beforeUserCreate = async () => {
    if (!config.signup.open) throw refuse('FORBIDDEN', 'signup_closed');
    const ip = requestContext.getStore()?.ip;
    if (!ip) return;
    const row = db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'auth.signup'),
          eq(auditLog.ip, ip),
          gte(auditLog.at, new Date(Date.now() - DAY_MS)),
        ),
      )
      .get();
    if ((row?.n ?? 0) >= config.signup.limitPerIpPerDay) {
      throw refuse('TOO_MANY_REQUESTS', 'signup_limit');
    }
  };

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
    async sendVerificationOTP({ email, otp, type }) {
      if (type === 'change-email') throw refuse('FORBIDDEN', 'not_supported');
      try {
        await mailer({ to: email, ...codeEmail(type, otp) });
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
    account: { modelName: 'authAccounts' },
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
            audit.record({
              userEmail: user.email,
              accountId: null,
              action: 'auth.signup',
              entity: user.id,
              result: 'ok',
            });
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
    },
    // The cast covers a typing gap of test-utils under exactOptionalPropertyTypes; tests read it through $context.
    plugins: deps.testUtils ? [codeLogin, testUtils() as BetterAuthPlugin] : [codeLogin],
  });
}

export type Auth = ReturnType<typeof createAuth>;
