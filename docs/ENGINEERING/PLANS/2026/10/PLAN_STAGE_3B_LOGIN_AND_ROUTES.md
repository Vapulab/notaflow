# Stage 3b: Own Login and Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users log in to NotaFlow with an e-mail code, Google, a password, or a passkey, through Better Auth inside the server, and the web moves to path routes. Cloudflare Access can then leave the hostname.

**Architecture:**

- Better Auth 1.7.7 runs in the Fastify server at `/api/auth/*`, on the existing SQLite database through its Drizzle adapter. Its user model is the existing `users` table, so current users keep their ids, accounts, and invoices.
- `authHook` reads the Better Auth session cookie instead of the Cloudflare Access JWT. The guards (`identityOf`, `accountContext`, `adminContext`) and the route sweep keep their contract.
- E-mail goes through a small `Mailer` port: Resend over HTTPS in production, a console mailer in development, and a capturing fake in tests.
- The web replaces hash routes with path routes, adds the login, signup, and reset pages and the account page, and redirects old `#/` links.

**Tech Stack:** Better Auth 1.7.7 (`better-auth`, `@better-auth/passkey`), Fastify 5, Drizzle ORM 0.45 and drizzle-kit 0.31, SQLite, React 19, Vite, Vitest, Resend HTTP API, Cloudflare Turnstile.

**Spec:** [RFC_SAAS_SIGNUP](../../RFCS/2026/10/RFC_SAAS_SIGNUP.md), section "Stage 3b: Own Login and Routes", plus "Security" and "Testing and Acceptance".

## Spike result (2026-10-10, throwaway, not committed)

Better Auth 1.7.7 with the Drizzle adapter ran on a copy of the `users` shape (text id, partial unique e-mail index, `users_no_delete` trigger):

- An e-mail code login for an existing user returned a session for the **same id** (`old-user-1`), kept `platform_role`, and set `email_verified`.
- A new e-mail created a user with a UUID id and an empty name.
- `schema` must be keyed by the **model name** (`{ users, authSessions, ... }`), not by `user`/`session`.
- `generateId: 'uuid'` logs a warning on an internal id; `generateId: () => randomUUID()` does not.
- Sign-out deleted the session row; the used code was deleted from the verification table.

## Decisions to confirm with Lincoln before Task 1

These fill gaps in the RFC. Each is the plan's default; a "no" changes only the named task.

1. **Account in the URL** (Task 7). The RFC lists `/app/notas`; a user can belong to several accounts, so the path carries the account: `/app/:accountId/notas`. `/app` alone opens the account picker (today's home), or the only account. `conta` and `comecar` are reserved names under `/app`.
2. **Signup switch** (Task 3). `SIGNUP_OPEN=false` in production until stage 3c ships onboarding. A new e-mail then gets "O cadastro de novas empresas abre em breve." Existing users log in normally. Access can leave the hostname in 3b without strangers landing in an empty app.
3. **Credential tables** (Task 2). Better Auth deletes a row when a user unlinks Google (`auth_accounts`) or removes a passkey (`auth_passkeys`). The RFC names only sessions and codes as exceptions. The plan treats all four `auth_*` tables as credentials outside the soft delete rule, and the audit log keeps every unlink and removal.
4. **Access code removed** (Task 4). The Access JWT verifier and `AUTH_MODE=access` go away. Rollback is the previous image tag with the previous `.env`, which still works because Access stays on until the cut-over.

## External setup (Lincoln, before Task 10)

- **Resend:** an account, the domain `notaflow.vapulab.com` added, and its DNS records created in Cloudflare (sub-names only: `send.notaflow`, `resend._domainkey.notaflow`). An API key with "sending access" for that domain.
- **Google OAuth client** (Google Cloud console): type "Web application", authorized origin `https://notaflow.vapulab.com`, redirect URI `https://notaflow.vapulab.com/api/auth/callback/google`, scopes `openid email profile`. App name "NotaFlow". The privacy and terms URLs come in 3d; until then the consent screen stays in "Testing" with Lincoln and Diogo as test users.
- **Turnstile widget** (Cloudflare dashboard): hostname `notaflow.vapulab.com` (and `localhost` for the local sweep), mode "Managed". It gives a site key and a secret key.

## Global Constraints

- **Versions:** `better-auth@1.7.7` and `@better-auth/passkey@1.7.7`, exact (no caret).
- **Auth path:** Better Auth `basePath` is `/api/auth`; `baseURL` is `APP_ORIGIN`.
- **Cookies:** prefix `notaflow`; `httpOnly`, `SameSite=Lax`, `Secure` when `APP_ORIGIN` is https. Session 30 days, renewed once a day of use (`expiresIn: 60*60*24*30`, `updateAge: 60*60*24`).
- **E-mail code:** 6 digits, 600 seconds, 5 tries (`otpLength: 6, expiresIn: 600, allowedAttempts: 5`), stored hashed.
- **Password:** at least 10 characters; a password in Have I Been Pwned is refused (`haveIBeenPwned` plugin).
- **Sender:** `NotaFlow <nao-responda@notaflow.vapulab.com>`, no reply-to. Every e-mail is Portuguese and ends with "Este e-mail é automático e não recebe respostas."
- **Ids:** `advanced.database.generateId: () => randomUUID()`.
- **Disabled Better Auth paths:** `/delete-user`, `/delete-user/callback`, `/change-email`, `/email-otp/change-email`, `/email-otp/request-email-change`. Erasure stays the admin anonymize route; e-mail change is out of scope.
- **Abuse limits:** Better Auth rate limit on (`rateLimit.enabled: true`, storage `memory`); Turnstile on `/sign-up/email`, `/email-otp/send-verification-otp`, `/email-otp/request-password-reset`, `/forget-password/email-otp`; at most `SIGNUP_LIMIT_PER_IP_DAY` (default 5) new users per IP per 24 hours.
- **Client IP** for Better Auth is the `requestContext` IP (the Cloudflare rule from 3a), passed in an internal header that the server overwrites on every request.
- **Secrets** (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`) live in `/opt/notaflow/.env` on the VPS only. Never in git, logs, or test output.
- **Data rules (3a):** `users` stays a business table (no delete, stamps, `notDeleted`). The four `auth_*` tables go in `OTHER_TABLES`.
- **Project rules:** no TypeScript non-null assertions; no AI attribution; English text follows the Writing Style with no em dash; scripts run on Windows and Linux; never `--no-verify`.

## Review Focus

1. **A removed user with a live cookie or a code.** Better Auth finds users by e-mail without `deleted_at`. Expected: a soft-deleted user cannot get a session (`session.create.before` refuses), an existing session of that user gets 401, and anonymize ends the user's sessions. Pinned in Tasks 3 and 4.
2. **Google takes over an account.** Expected: Google links to an existing user only when Google says the e-mail is verified; an unverified Google e-mail equal to an existing user's is refused. Pinned in Task 6.
3. **The internal IP header forged by a client.** Expected: a request that sends `x-notaflow-client-ip` itself still counts under its real IP for rate limits and the per-IP signup limit. Pinned in Task 3.
4. **Old links.** Expected: every `#/a/:account/...` link of today's app, including `invoices/new?customer=` and `.../issue`, lands on its new path with `replaceState`, and an unknown hash lands on `/app`. Pinned in Task 7.
5. **A page reload on a deep path.** Expected: the server serves `index.html` for `/app/...`, `/entrar`, `/cadastro`, `/recuperar-senha`, and `/admin`, while `/api/...` never falls back to HTML. Pinned in Task 7.

---

### Task 1: Configuration

**Files:**
- Modify: `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/.env.example` (create it if absent)

**Interfaces:**
- Produces:

```ts
export type AuthConfig = { mode: 'session' } | { mode: 'dev'; email: string };

export interface Config {
  // ...existing fields...
  auth: AuthConfig;
  authSecret: string;
  mail: { from: string; resendApiKey: string | null };
  google: { clientId: string; clientSecret: string } | null;
  turnstile: { siteKey: string; secretKey: string } | null;
  signup: { open: boolean; limitPerIpPerDay: number };
}
```

- [ ] **Step 1: Failing tests** in `config.test.ts`:
  - `AUTH_MODE=session` with `BETTER_AUTH_SECRET` of 32+ characters is valid; a shorter secret is a problem `BETTER_AUTH_SECRET must have at least 32 characters`.
  - `AUTH_MODE=access` is now a problem `AUTH_MODE must be session or dev`.
  - In production: `RESEND_API_KEY` and both Turnstile keys are required.
  - `GOOGLE_CLIENT_ID` without `GOOGLE_CLIENT_SECRET` (or the reverse) is a problem; neither means `google: null`. Same for the two Turnstile keys outside production.
  - `SIGNUP_OPEN` accepts `true` or `false` (default `false`); `SIGNUP_LIMIT_PER_IP_DAY` is a whole number from 1 to 1000 (default 5).
  - `MAIL_FROM` defaults to `NotaFlow <nao-responda@notaflow.vapulab.com>`.
  - Existing dev-mode tests still pass; dev mode needs no `BETTER_AUTH_SECRET` (it uses a fixed development secret).
- [ ] **Step 2:** `pnpm vitest run apps/server/src/config.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Remove `teamDomain` and `audience`. Document every variable in `.env.example` with a placeholder, never a value.
- [ ] **Step 4:** Test → PASS (other server tests that build a config may fail until Task 4; run only this file). Commit `feat(server): configuration for the own login`.

### Task 2: Auth tables

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/db/businessTables.ts`
- Create: `apps/server/drizzle/0009_auth_tables.sql` (generated, then edited) and its snapshot
- Test: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces in `schema.ts`: `users.emailVerified` (`email_verified`, integer boolean, not null, default false) and `users.image` (`image`, text); tables `authSessions` (`auth_sessions`), `authAccounts` (`auth_accounts`), `authVerifications` (`auth_verifications`), `authPasskeys` (`auth_passkeys`), with the Better Auth fields below. All timestamps are `integer(..., { mode: 'timestamp_ms' })`; every `user_id` references `users.id`.

| Table | Columns |
| --- | --- |
| `auth_sessions` | `id` pk, `user_id`, `token` unique, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at` |
| `auth_accounts` | `id` pk, `user_id`, `account_id`, `provider_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at` |
| `auth_verifications` | `id` pk, `identifier` (indexed), `value`, `expires_at`, `created_at`, `updated_at` |
| `auth_passkeys` | `id` pk, `name`, `public_key`, `user_id`, `credential_id` (indexed), `counter`, `device_type`, `backed_up` (boolean), `transports`, `created_at`, `aaguid` |

- `OTHER_TABLES` becomes `['audit_log', 'auth_sessions', 'auth_accounts', 'auth_verifications', 'auth_passkeys']`, with the comment "Append-only, or credentials that Better Auth deletes on expiry, sign-out, unlink, or removal."

- [ ] **Step 1: Failing tests** in `migrations.test.ts`:
  - On a database migrated to `0008` with one user, the full migration keeps the user and sets `email_verified = 1` (current users proved their e-mail through Access).
  - The four `auth_*` tables exist; `DELETE FROM auth_sessions` works (no trigger).
  - The catalog test (every table is business or other) passes with the new tables.
  - `users_no_delete` still exists after the migration (Review Focus 1 of 3a: adding columns must not rebuild `users`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the tables and columns. Run `pnpm --filter @notaflow/server exec drizzle-kit generate --name auth_tables`. Read the SQL: it must use `ALTER TABLE users ADD` (no rebuild). Append `UPDATE users SET email_verified = 1;--> statement-breakpoint`.
- [ ] **Step 4:** Migration test, typecheck, lint → PASS. Commit `feat(server): tables for the own login`.

### Task 3: Better Auth, the mailer, and the e-mail code

**Files:**
- Create: `apps/server/src/mail/mailer.ts`, `apps/server/src/mail/templates.ts`, `apps/server/src/mail/mailer.test.ts`
- Create: `apps/server/src/auth/betterAuth.ts`, `apps/server/src/auth/authRoutes.ts`, `apps/server/src/auth/betterAuth.test.ts`
- Modify: `apps/server/package.json` (add `better-auth` and `@better-auth/passkey`, exact 1.7.7), `apps/server/src/app.ts`

**Interfaces:**
- Produces in `mail/mailer.ts`:

```ts
export interface MailMessage { to: string; subject: string; html: string; text: string }
export type Mailer = (message: MailMessage) => Promise<void>;
export function resendMailer(options: { apiKey: string; from: string; dispatcher?: Dispatcher }): Mailer;
export function consoleMailer(log: (line: string) => void): Mailer; // development: prints the subject and text, never in production
```

- Produces in `mail/templates.ts`: `codeEmail(kind: 'sign-in' | 'email-verification' | 'forget-password', code: string): { subject: string; html: string; text: string }` and `welcomeEmail(name: string)`. Subjects: "Seu código de acesso ao NotaFlow", "Confirme seu e-mail no NotaFlow", "Código para redefinir sua senha". HTML uses inline styles with the Malphas colors from `apps/web/src/malphas/tokens.css` (light values), a 6-digit code in a monospace block, "O código vale por 10 minutos.", and the fixed footer.
- Produces in `auth/betterAuth.ts`:

```ts
export interface AuthDeps {
  config: Config;
  db: Database;
  mailer: Mailer;
  // Tests only: replace Google's user info, and add the test-utils plugin.
  googleUserInfo?: (tokens: OAuth2Tokens) => Promise<{ user: { id: string; email: string; name: string; emailVerified: boolean; image?: string }; data: Record<string, unknown> }>;
  testUtils?: boolean;
}
export function createAuth(deps: AuthDeps): Auth; // Auth = ReturnType<typeof betterAuth> with this plugin list
export const CLIENT_IP_HEADER = 'x-notaflow-client-ip';
```

- Produces in `auth/authRoutes.ts`: `registerAuthRoutes(app: FastifyInstance, auth: Auth): void`, mounting `GET` and `POST` on `/api/auth/*`.
- `buildApp` gains `AppDeps.mailer?: Mailer` and `AppDeps.auth?: Auth`, and decorates `app.auth`.

- [ ] **Step 1: Failing tests.**
  - `mailer.test.ts`: `resendMailer` posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>`, the `from`, `to`, `subject`, `html`, and `text`, and no `reply_to` (undici `MockAgent`); a non-2xx answer throws an error whose message has the status but not the key. Every template's text ends with the footer and holds the code.
  - `betterAuth.test.ts`, through `app.inject` against `createTestApp()` with a capturing mailer (Task 4 adds it to the test app; in this task build the app inline with `buildApp` and a `consoleMailer` substitute that pushes to an array):
    1. An existing user (seeded with `seedTenant`) asks for a code (`POST /api/auth/email-otp/send-verification-otp`, `{ email, type: 'sign-in' }`), gets one e-mail with 6 digits, signs in (`POST /api/auth/sign-in/email-otp`), and receives a `notaflow.session_token` cookie. The session's user id equals the seeded id.
    2. With `SIGNUP_OPEN=true`, a new e-mail gets a new user with `platform_role = 'user'` and no membership; with `SIGNUP_OPEN=false` the sign-in answers 403 `signup_closed` and no user row exists.
    3. A wrong code 5 times, then the right one, is refused (`allowedAttempts`).
    4. A code older than 10 minutes is refused (fake timers or a direct update of `auth_verifications.expires_at`).
    5. **Review Focus 1:** a soft-deleted user (`softDelete`) who signs in with a code gets 403 `account_removed` and no `auth_sessions` row.
    6. **Review Focus 3:** two code requests from `remoteAddress` 203.0.113.7, each with `x-notaflow-client-ip: 198.51.100.1`, count under 203.0.113.7; with `SIGNUP_LIMIT_PER_IP_DAY=1` the second new e-mail from that IP gets 429 `signup_limit`.
    7. `POST /api/auth/delete-user` answers 404.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `createAuth`:**

```ts
betterAuth({
  appName: 'NotaFlow',
  baseURL: config.appOrigin,
  basePath: '/api/auth',
  secret: config.authSecret,
  trustedOrigins: [config.appOrigin],
  database: drizzleAdapter(db, { provider: 'sqlite', schema: { users, authSessions, authAccounts, authVerifications, authPasskeys } }),
  user: { modelName: 'users' },
  session: { modelName: 'authSessions', expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  account: { modelName: 'authAccounts' },
  verification: { modelName: 'authVerifications' },
  disabledPaths: [/* Global Constraints */],
  rateLimit: { enabled: true, storage: 'memory' },
  advanced: {
    cookiePrefix: 'notaflow',
    useSecureCookies: config.appOrigin.startsWith('https://'),
    database: { generateId: () => randomUUID() },
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
  databaseHooks: {
    user: { create: { before: refuseClosedOrOverLimit } },   // signup_closed, signup_limit
    session: { create: { before: refuseRemovedUser } },        // account_removed
  },
  plugins: [emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: 'hashed', sendVerificationOTP }), ...(deps.testUtils ? [testUtils({ captureOTP: true })] : [])],
});
```

  - The before-hooks throw `new APIError('FORBIDDEN', { code: 'signup_closed', message: 'signup closed' })` (and `TOO_MANY_REQUESTS` with `signup_limit`, `FORBIDDEN` with `account_removed`). Better Auth answers `{ code, message }`; the web reads `code`.
  - `refuseClosedOrOverLimit` counts `audit_log` rows with `action = 'auth.signup'`, the current `requestContext` IP, and `at` in the last 24 hours.
  - `sendVerificationOTP` renders `codeEmail` and calls the mailer; a mailer error is logged with the e-mail domain only and rethrown, so the user sees "Não foi possível enviar o código".
  - `registerAuthRoutes` builds a Web `Request` from the Fastify request: the URL from `config.appOrigin` plus `request.url`, every header except `CLIENT_IP_HEADER`, then `CLIENT_IP_HEADER` set to `requestContext.getStore()?.ip`, and the JSON body re-serialized for `POST`. It copies the status, every header, and each `set-cookie` from `response.headers.getSetCookie()` separately.
  - `buildApp` uses `deps.mailer ?? (config.mail.resendApiKey ? resendMailer(...) : consoleMailer(...))`, and `consoleMailer` is refused in production by the config (Task 1).
- [ ] **Step 4:** Tests, typecheck, lint → PASS. Commit `feat(server): Better Auth with the e-mail code`.

### Task 4: The session drives the guards

**Files:**
- Modify: `apps/server/src/auth/authHook.ts`, `apps/server/src/repos/IdentityRepository.ts`, `apps/server/src/repos/AdminRepository.ts` (`anonymizeUser`), `apps/server/src/app.ts`, `apps/server/test/testApp.ts`, `apps/server/src/routes/me.ts`
- Delete: `apps/server/src/auth/accessVerifier.ts`, `apps/server/src/auth/accessVerifier.test.ts`
- Create: `apps/server/src/routes/publicConfig.ts`
- Test: `apps/server/src/auth/auth.test.ts` (rewrite), `apps/server/src/app.test.ts`, `apps/server/src/web.test.ts`, `apps/server/src/routes/routeSweep.test.ts`, `apps/server/src/routes/admin.test.ts`

**Interfaces:**
- Consumes `createAuth`, `Auth`, `app.auth` (Task 3).
- Produces: `IdentityRepository.findById(userId: string): Identity | null` (with `notDeleted(users)`); `findByEmail` stays for dev mode. `TestApp` keeps `as(email)` and gains `mail: MailMessage[]` (the capturing mailer) and `cookieFor(email): Promise<string>`; `tokenFor` is removed.
- Produces: `GET /api/public/config` → `{ googleEnabled: boolean; turnstileSiteKey: string | null; signupOpen: boolean }`, public.

- [ ] **Step 1: Failing tests.**
  - `auth.test.ts`: no cookie → 401 `unauthenticated`; a forged cookie → 401; a valid session → `GET /api/me` returns the user and accounts; a session whose user was soft-deleted → 401 (**Review Focus 1**); a mutation without the app Origin → 403 `bad_origin`; a non-JSON mutation → 415; `/api/auth/*` is not touched by the Origin or JSON checks (Better Auth checks its own origin: a `POST /api/auth/sign-out` with `Origin: https://evil.example` is refused by Better Auth with 403).
  - `admin.test.ts`: anonymize removes the user's `auth_sessions` rows, and the old cookie gets 401.
  - `routeSweep.test.ts`: `PUBLIC` holds `GET /api/health` and `GET /api/public/config`; routes under `/api/auth/` are skipped by "requires authentication" and covered by a new test: `GET /api/auth/get-session` without a cookie answers 200 with `null`, and `POST /api/auth/sign-out` without a cookie does not create a session.
  - `app.test.ts`: dev mode still authenticates as `DEV_USER_EMAIL`.
- [ ] **Step 2:** Run the server suite → FAIL in those files.
- [ ] **Step 3: Implement.**
  - `authHook`: skip `/api/health`, `/api/public/config`, and every route starting with `/api/auth/`. In session mode, `const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })`; no session → 401; `identities.findById(session.user.id)`; null → 401 `unauthenticated` (a removed user). Keep the Origin and JSON checks and `touchLogin`. Remove `access_not_granted` (a session always has a user row).
  - `anonymizeUser` ends sessions with `tx.delete(authSessions).where(eq(authSessions.userId, userId))` in the same transaction (allowed: `auth_sessions` is not a business table).
  - `testApp.ts`: build the app with `createAuth({ ..., mailer: capture, testUtils: true })`; `cookieFor(email)` looks up the user id and calls `(await auth.$context).test.getAuthHeaders({ userId })`, caching per e-mail; `as(email)` returns `{ cookie, origin: ORIGIN, 'content-type': 'application/json' }`.
  - Delete the Access verifier and the `jose` dependency if nothing else imports it.
- [ ] **Step 4:** `pnpm vitest run apps/server` (whole server suite: every route test now logs in by cookie), typecheck, lint → PASS. Commit `feat(server): the session cookie authenticates every request`.

### Task 5: Password, reset, Turnstile

**Files:**
- Modify: `apps/server/src/auth/betterAuth.ts`
- Test: `apps/server/src/auth/password.test.ts`, `apps/server/src/auth/turnstile.test.ts`

- [ ] **Step 1: Failing tests** (`MockAgent` as the global dispatcher for `api.pwnedpasswords.com` and `challenges.cloudflare.com`; restore it in `afterEach`):
  - Sign-up with e-mail and password (`POST /api/auth/sign-up/email`) with 9 characters → 400; with a password whose SHA-1 suffix the mock lists → 400 with the Portuguese message "Esta senha apareceu em vazamentos conhecidos. Escolha outra."; a good password → a verification code e-mail, and no session until `POST /api/auth/email-otp/verify-email`, which then signs in.
  - Sign-in with password before the e-mail is verified → 403.
  - Reset: `POST /api/auth/email-otp/request-password-reset` sends a code (also for a user who never had a password); `POST /api/auth/email-otp/reset-password` with the code sets the password, and the old sessions of that user end.
  - Turnstile: with `turnstile` configured, `send-verification-otp` without `x-captcha-response` → 400; with a token the mock accepts → 200; the mock receives the secret and the client IP from the request context.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.**
  - `emailAndPassword: { enabled: true, minPasswordLength: 10, requireEmailVerification: true, revokeSessionsOnPasswordReset: true }`.
  - `emailOTP({ ..., sendVerificationOnSignUp: true, overrideDefaultEmailVerification: true })`, and `emailVerification: { autoSignInAfterVerification: true }`.
  - `haveIBeenPwned({ customPasswordCompromisedMessage: '...' })`.
  - `captcha({ provider: 'cloudflare-turnstile', secretKey, endpoints: [...] })` only when `config.turnstile` is set.
- [ ] **Step 4:** PASS, then the server suite. Commit `feat(server): password login, reset, and Turnstile`.

### Task 6: Google, passkey, and the auth audit

**Files:**
- Create: `apps/server/src/auth/authAudit.ts`, `apps/server/src/auth/authAudit.test.ts`, `apps/server/src/auth/google.test.ts`
- Modify: `apps/server/src/auth/betterAuth.ts`

**Interfaces:**
- Produces in `authAudit.ts`: `authAuditHook(audit: AuditLog)`, a Better Auth `hooks.after` middleware, and the action names `auth.signup`, `auth.login` (detail: `email-otp`, `password`, `google`, `passkey`), `auth.logout`, `auth.code_sent` (detail: the code kind), `auth.login_failed`, `auth.password_reset`, `auth.passkey_added`, `auth.passkey_removed`, `auth.google_linked`, `auth.google_unlinked`, `auth.sessions_revoked`. The `entity` is the user id, or the e-mail domain when no user exists. A code is never in the detail.

- [ ] **Step 1: Failing tests.**
  - `authAudit.test.ts`: each event of the list above, driven through `app.inject`, writes one `audit_log` row with its action, result `ok` or `refused`, and the request IP from 3a. A failed code writes `auth.login_failed`. `auth.signup` is also what the per-IP limit of Task 3 counts.
  - `google.test.ts` (**Review Focus 2**): `GOOGLE_CLIENT_ID/SECRET` set; a `MockAgent` answers `POST https://oauth2.googleapis.com/token`; `googleUserInfo` returns the profile. Start with `POST /api/auth/sign-in/social` `{ provider: 'google', callbackURL: '/app' }`, take the `state` from the returned URL and the state cookie, then call `GET /api/auth/callback/google?code=x&state=...`.
    - Verified e-mail of an existing user → session for that user's id and an `auth_accounts` row with `provider_id = 'google'`.
    - Unverified e-mail of an existing user → no session, redirect with an error, no `auth_accounts` row.
    - Verified new e-mail with `SIGNUP_OPEN=false` → refused with `signup_closed`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.**
  - `socialProviders.google: { clientId, clientSecret, ...(deps.googleUserInfo ? { getUserInfo: deps.googleUserInfo } : {}) }` when `config.google` is set.
  - `account.accountLinking: { enabled: true, trustedProviders: [] }`, so linking needs Google's verified e-mail.
  - `passkey({ rpID: new URL(config.appOrigin).hostname, rpName: 'NotaFlow', origin: config.appOrigin, schema: { passkey: { modelName: 'authPasskeys' } } })`.
  - `hooks.after: authAuditHook(new AuditLog(db))`, reading `ctx.path`, `ctx.context.newSession`, and `ctx.context.returned`.
  - If the Google test cannot reach the token exchange through `MockAgent` (Better Auth uses the global `fetch`), rule it in the ledger and override `verifyIdToken` and `getUserInfo` through `AuthDeps` instead; the linking assertions stay.
- [ ] **Step 4:** PASS, server suite. Commit `feat(server): Google, passkey, and the audit of every login`.

### Task 7: Path routes

**Files:**
- Modify: `apps/web/src/router.ts`, `apps/web/src/router.test.ts`, `apps/web/src/App.tsx`, every file that sets `window.location.hash` (`useIssueSend.ts`, `InvoicesPage.tsx`) and every test that builds a `#/` URL
- Modify: `apps/server/src/web.ts`, `apps/server/src/web.test.ts`

**Interfaces:**
- Produces in `router.ts`:

```ts
export type Route =
  | { name: 'login' } | { name: 'signup' } | { name: 'reset' }
  | { name: 'home' } | { name: 'profile' } | { name: 'admin' }
  | /* the existing account routes, unchanged */;
export function parseRoute(location: { pathname: string; search: string }): Route;
export function routeHref(route: Route): string;          // a path, such as /app/<id>/notas
export function legacyHashTarget(hash: string): string | null; // '#/a/x/invoices' -> '/app/x/notas'
export function navigate(route: Route | string, options?: { replace?: boolean }): void;
export function useRoute(): Route;
```

| Route | Path |
| --- | --- |
| login, signup, reset | `/entrar`, `/cadastro`, `/recuperar-senha` |
| home | `/app` |
| profile | `/app/conta` |
| admin | `/admin` |
| invoices, invoice, newInvoice, issue | `/app/:a/notas`, `/app/:a/notas/:id`, `/app/:a/notas/nova?cliente=:c`, `/app/:a/notas/:id/emitir` |
| customers, customer | `/app/:a/clientes`, `/app/:a/clientes/:id` |
| emitters, emitter | `/app/:a/emitentes`, `/app/:a/emitentes/:id` |
| members | `/app/:a/membros` |

- [ ] **Step 1: Failing tests.**
  - `router.test.ts`: the table above both ways; `routeHref` is the inverse of `parseRoute` with ids that need encoding; `/` and unknown paths parse to `home`; `/app/conta` and `/app/comecar` never parse as an account id.
  - **Review Focus 4:** `legacyHashTarget` maps every old form (`#/`, `#/admin`, `#/a/x/emitters`, `#/a/x/emitters/e`, `#/a/x/invoices`, `#/a/x/invoices/new?customer=c`, `#/a/x/invoices/i`, `#/a/x/invoices/i/issue`, `#/a/x/members`, `#/a/x/customers`, `#/a/x/customers/c`) and returns `/app` for an unknown hash and `null` for an empty one.
  - A click on a same-origin `<a href="/app/x/notas">` without a modifier key calls `pushState` and re-renders; a click with Ctrl or on `target="_blank"` does not.
  - `web.test.ts` (**Review Focus 5**): `GET /app/x/notas`, `/entrar`, `/cadastro`, `/recuperar-senha`, and `/admin` answer `index.html`; `GET /api/nothing` stays 401 JSON.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** `useRoute` listens to `popstate` and to a custom `notaflow:navigate` event that `navigate` dispatches, and installs one document click handler for internal links. On first render, `legacyHashTarget(location.hash)` replaces the URL. Replace each `window.location.hash = routeHref(...)` with `navigate(...)`. `web.ts` needs no change if the tests pass; the root `/` serves `index.html`, and the SPA sends a visitor to `/entrar` or `/app` (stage 3d puts the landing there).
- [ ] **Step 4:** Web suite, server `web.test.ts`, typecheck, lint, `pnpm build:web` → PASS. Commit `feat(web): path routes, with old links redirected`.

### Task 8: Login, signup, and reset pages

**Files:**
- Modify: `apps/web/package.json` (add `better-auth` and `@better-auth/passkey`, exact 1.7.7)
- Create: `apps/web/src/auth/authClient.ts`, `apps/web/src/auth/Turnstile.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/SignupPage.tsx`, `apps/web/src/pages/ResetPage.tsx`, `apps/web/src/pages/auth.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/MeContext.tsx`, `apps/web/src/components/Layout.tsx` (the "Sair" button, error texts), `apps/web/src/api.ts` (`PublicConfig`)

**Interfaces:**
- Produces in `authClient.ts`: `authClient = createAuthClient({ basePath: '/api/auth', plugins: [emailOTPClient(), passkeyClient()] })` and `signOut(): Promise<void>` (Better Auth sign-out, then `navigate('/entrar', { replace: true })`).
- Produces: `usePublicConfig()` reading `GET /api/public/config` once.

- [ ] **Step 1: Failing tests** (`auth.test.tsx`, with `stubApi` for `/api/*` and a stubbed `authClient`):
  - Login page, in this order: "Receber código por e-mail" (e-mail field, then a 6-digit code field with `autocomplete="one-time-code"` and `inputmode="numeric"`), "Entrar com Google" (only when `googleEnabled`), "Entrar com senha", and "Entrar com passkey" (only when `window.PublicKeyCredential` exists). A successful login goes to the `volta` query parameter when it is an internal path starting with `/app` or `/admin`, else to `/app`. An external `volta` (`https://evil.example`, `//evil.example`) goes to `/app`.
  - Error codes map to Portuguese texts in `ERROR_TEXT`: `signup_closed`, `signup_limit`, `account_removed`, an invalid or expired code, too many tries, a compromised password, and rate limit (429).
  - Signup page: name, e-mail, password with a 10-character hint, then the code step; with `signupOpen: false` it shows "O cadastro de novas empresas abre em breve." and a link to `/entrar`.
  - Reset page: e-mail, then code and new password, then a link to `/entrar`.
  - The Turnstile widget renders only when `turnstileSiteKey` is set, and its token goes in the `x-captcha-response` header of the code, signup, and reset calls.
  - `MeProvider`: a 401 from `/api/me` sends the browser to `/entrar?volta=<current path>`.
  - "Sair" calls `signOut` (not `/cdn-cgi/access/logout`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** with the Malphas components in `apps/web/src/ui` (`Field`, `Button`, `Alert`, the card classes). `Turnstile.tsx` loads `https://challenges.cloudflare.com/turnstile/v0/api.js` once, with `render=explicit`. Public pages render without `MeProvider`.
- [ ] **Step 4:** Web suite, typecheck, lint, build → PASS. Commit `feat(web): login, signup, and password reset pages`.

### Task 9: Account page

**Files:**
- Create: `apps/web/src/pages/ProfilePage.tsx`, `apps/web/src/pages/ProfilePage.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/Layout.tsx` (a "Minha conta" link in the user menu)

- [ ] **Step 1: Failing tests:** the page `/app/conta` shows and saves the name (`authClient.updateUser`); "Criar senha" or "Alterar senha" sends a reset code and then sets the password (the same OTP flow, so a user who never had a password can create one); lists passkeys with "Adicionar passkey" and "Remover"; shows Google as linked or "Vincular Google" (`linkSocial`) and "Desvincular" only when another login method remains; lists active sessions with browser, IP, and last use, marks the current one, and "Sair de todos os dispositivos" calls `revokeSessions` and goes to `/entrar`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; commit `feat(web): account page with password, passkeys, Google, and sessions`.

### Task 10: Docs, local browser sweep, and the production cut-over

- [ ] **Docs.**
  - `docs/ENGINEERING/ARCHITECTURE/TENANCY.md`: the session replaces the Access JWT; the guards are unchanged.
  - `docs/ENGINEERING/CONVENTIONS/DATA.md` "Exceptions": the four `auth_*` tables.
  - `docs/ENGINEERING/CONVENTIONS/SECRETS.md`: the four new secrets and where they live.
  - `apps/server/AGENTS.md` and `apps/web/AGENTS.md`: Better Auth entry points, the router, and how tests log in (`t.as`).
  - The RFC: status "Stage 3b implemented"; close the Better Auth open question with the versions and plugins used.
  - `AGENTS.md` commands table: `pnpm dev:server` now prints e-mail codes to the console.
- [ ] **Local browser sweep with Playwright** (dev server, `SIGNUP_OPEN=true`, console mailer, Turnstile test keys `1x00000000000000000000AA` and `1x0000000000000000000000000000000AA`):
  1. Signup by code, logout, login by code, then by password after creating one on the account page.
  2. Add a passkey with a CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`), log out, log in with the passkey, and remove it.
  3. Reset the password.
  4. An old `#/a/<id>/invoices` link and a reload on `/app/<id>/notas`.
  5. Phone width (390 px) and desktop, light and dark.
  6. Zero console errors.
- [ ] Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pytest services/signer-py` → PASS. Build the image from `git archive HEAD`; it starts and `/api/health` is ok.
- [ ] Commit `docs: own login and routes`.
- [ ] **Production cut-over** (each step after Lincoln's go-ahead; Access stays on until step 5):
  1. Back up the database (`notaflow-backup.service`).
  2. Write the new variables into `/opt/notaflow/.env` (`AUTH_MODE=session`, `BETTER_AUTH_SECRET` from `openssl rand -base64 48`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `SIGNUP_OPEN=false`) and remove `CF_ACCESS_*`. Print variable names only.
  3. Merge the PR (deploy). Check the container is healthy, the logs have no errors, and the migration count is 10.
  4. Lincoln and Diogo log in behind Access with each method: code, Google, password, passkey. Check the audit log has each `auth.login`.
  5. Delete the Access application of the hostname. Check the public URL answers the login page, and `/api/me` without a cookie is 401.
