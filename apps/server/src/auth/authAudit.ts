import { createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { authAccounts, users } from '../db/schema';
import type { AuditLog } from '../repos/AuditLog';
import { type RequestInfo, requestContext } from '../requestContext';

interface Actor {
  userId: string;
  email: string;
}

const LOGIN_METHOD: Record<string, string> = {
  '/sign-in/email-otp': 'email-otp',
  '/email-otp/verify-email': 'email-otp',
  '/sign-in/email': 'password',
  '/callback/:id': 'google',
  '/passkey/verify-authentication': 'passkey',
};
const CODE_PATHS: Record<string, string> = {
  '/email-otp/send-verification-otp': '',
  '/email-otp/request-password-reset': 'forget-password',
  '/forget-password/email-otp': 'forget-password',
};
// The session is gone once these run, so its owner is read before.
const NEEDS_ACTOR_BEFORE = new Set([
  '/sign-out',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/passkey/delete-passkey',
  '/passkey/verify-registration',
  '/unlink-account',
  '/change-password',
]);
const actors = new WeakMap<RequestInfo, Actor>();
const unlinkedProviders = new WeakMap<RequestInfo, string>();

// Every login, code, and credential change goes to the audit log; a code is never written.
export function authAuditHooks(db: Database, audit: AuditLog) {
  const userByEmail = (email: string): Actor | null => {
    const row = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .get();
    return row ? { userId: row.id, email: row.email } : null;
  };
  const record = (
    action: string,
    actor: Actor | null,
    fallbackEmail: string,
    result: 'ok' | 'refused',
    detail?: string,
  ) => {
    const email = actor?.email ?? fallbackEmail.toLowerCase();
    audit.record({
      userEmail: email,
      accountId: null,
      action,
      entity: actor?.userId ?? `@${email.split('@')[1] ?? ''}`,
      result,
      ...(detail ? { detail } : {}),
    });
  };

  const before = createAuthMiddleware(async (ctx) => {
    if (!NEEDS_ACTOR_BEFORE.has(ctx.path)) return;
    const store = requestContext.getStore();
    const session = await getSessionFromCtx(ctx);
    if (store && session) actors.set(store, { userId: session.user.id, email: session.user.email });
    // Unlink names the account row, which is gone after the call.
    const accountId = (ctx.body as { accountId?: unknown } | undefined)?.accountId;
    if (store && ctx.path === '/unlink-account' && typeof accountId === 'string') {
      const row = db
        .select({ providerId: authAccounts.providerId })
        .from(authAccounts)
        .where(eq(authAccounts.id, accountId))
        .get();
      if (row) unlinkedProviders.set(store, row.providerId);
    }
  });

  const after = createAuthMiddleware(async (ctx) => {
    const failed = isAPIError(ctx.context.returned);
    const body = (ctx.body ?? {}) as { email?: unknown; type?: unknown };
    const typedEmail = typeof body.email === 'string' ? body.email : '';
    const store = requestContext.getStore();
    const before = store ? actors.get(store) : undefined;
    const actor = before ?? null;

    const method = LOGIN_METHOD[ctx.path];
    if (method) {
      const session = ctx.context.newSession;
      if (session) {
        record(
          'auth.login',
          { userId: session.user.id, email: session.user.email },
          '',
          'ok',
          method,
        );
      } else if (failed && method !== 'google') {
        record('auth.login_failed', userByEmail(typedEmail), typedEmail, 'refused', method);
      }
      return;
    }
    if (failed) return;
    const code = CODE_PATHS[ctx.path];
    if (code !== undefined) {
      const kind = code || (typeof body.type === 'string' ? body.type : '');
      record('auth.code_sent', userByEmail(typedEmail), typedEmail, 'ok', kind);
      return;
    }
    switch (ctx.path) {
      case '/email-otp/reset-password':
        record('auth.password_reset', userByEmail(typedEmail), typedEmail, 'ok');
        return;
      case '/sign-out':
        if (actor) record('auth.logout', actor, '', 'ok');
        return;
      case '/revoke-sessions':
      case '/revoke-other-sessions':
        if (actor) record('auth.sessions_revoked', actor, '', 'ok');
        return;
      case '/passkey/verify-registration':
        if (actor) record('auth.passkey_added', actor, '', 'ok');
        return;
      case '/passkey/delete-passkey':
        if (actor) record('auth.passkey_removed', actor, '', 'ok');
        return;
      case '/change-password':
        if (actor) record('auth.password_changed', actor, '', 'ok');
        return;
      case '/unlink-account':
        if (actor && store && unlinkedProviders.get(store) === 'google') {
          record('auth.google_unlinked', actor, '', 'ok');
        }
        return;
    }
  });

  return { before, after };
}

export function recordGoogleLinked(
  db: Database,
  audit: AuditLog,
  account: { userId: string; providerId: string },
): void {
  if (account.providerId !== 'google') return;
  const user = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, account.userId))
    .get();
  audit.record({
    userEmail: user?.email ?? '',
    accountId: null,
    action: 'auth.google_linked',
    entity: account.userId,
    result: 'ok',
  });
}
