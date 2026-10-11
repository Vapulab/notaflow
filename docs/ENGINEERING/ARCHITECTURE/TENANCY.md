# Tenancy

An account is the paying customer. A user is a person, identified by email. A membership links a user to an account with the role `owner` or `member`. A platform `admin` manages accounts and users, and has no access to an account's data by default.

## Request flow

1. Better Auth authenticates the person, inside the server at `/api/auth/*` (`src/auth/betterAuth.ts`): e-mail code, Google, e-mail and password, or passkey. The `notaflow.session_token` cookie is `httpOnly` and `SameSite=Lax`, lasts 30 days, and renews with use. In development, `AUTH_MODE=dev` skips the login and uses `DEV_USER_EMAIL`.
2. `authHook` reads the session and loads the user by id, with `notDeleted`. No session, or a removed user, answers 401 `unauthenticated`. `/api/health`, `/api/public/config`, and `/api/auth/*` need no session; Better Auth checks the origin of its own routes.
3. A mutation needs `Content-Type: application/json` and an `Origin` equal to `APP_ORIGIN`.
4. Before body validation, an account route checks the membership and an admin route checks the platform role. A user without a membership gets 404, so an account's existence does not leak. A user who is not a platform admin gets 403 `admin_only` on admin routes.
5. The handler builds its `AccountContext` with `accountContext()`. `owner` routes answer 403 `owner_only` to a member. A suspended account can read, and every mutation answers 403 `account_suspended`.

## Repositories

Every account query goes through a repository method that takes an `AccountContext` and filters by its `accountId`. Three places read without one, each marked in the code: the identity lookup during authentication, the platform admin repository (it takes an `AdminContext`), and the seed command.

## Route sweep

`apps/server/src/routes/routeSweep.test.ts` walks every registered route. It checks that each one needs authentication, that a user of another account gets 404, and that an account owner gets 403 on admin routes. The Better Auth routes are checked apart: they answer without a session and never open one.

## Login

- **Users keep their ids.** The Better Auth user model is the `users` table, so a first login by code lands in the same user, with the same accounts.
- **Signup** creates a user only while `SIGNUP_OPEN=true`, and at most `SIGNUP_LIMIT_PER_IP_DAY` new users per IP per day (counted from the `auth.signup` audit entries).
- **Google** links to an existing user only when Google says the e-mail is verified.
- **Abuse limits:** the Better Auth rate limit on every auth route, and Turnstile on signup, code sending, and password reset.
- **Audit:** every login (with its method), failed login, code sent, logout, password reset or change, passkey added or removed, and Google linked or unlinked (`src/auth/authAudit.ts`). A code is never written.
- **Tests** log in with `t.as(email)`: a real signed session cookie from the Better Auth test-utils plugin.
