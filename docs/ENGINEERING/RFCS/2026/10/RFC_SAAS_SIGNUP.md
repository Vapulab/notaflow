# RFC: Open Signup, Own Login, Guided Onboarding, and Soft Delete

**Status:** Accepted (Stage 3a and 3b implemented); Stage 3b plan: [PLAN_STAGE_3B_LOGIN_AND_ROUTES](../../../PLANS/2026/10/PLAN_STAGE_3B_LOGIN_AND_ROUTES.md)
**Date:** 2026-10-10
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [RFC: NotaFlow NFS-e Emitter](RFC_NFSE_EMITTER.md) (tenancy, vault, onboarding today)
- [Tenancy](../../../ARCHITECTURE/TENANCY.md) (accounts, roles, guards, route sweep)
- [Web UI](../../../ARCHITECTURE/WEB_UI.md) (Malphas, screens)
- Better Auth: <https://www.better-auth.com/docs>
- Resend: <https://resend.com/docs>
- BrasilAPI CNPJ: <https://brasilapi.com.br/docs#tag/CNPJ>
- Lei 13.709/2018 (LGPD)

## Table of Contents

1. [Overview](#overview)
2. [Goals and Non-Goals](#goals-and-non-goals)
3. [Decisions](#decisions)
4. [Delivery Order](#delivery-order)
5. [Stage 3a: Soft Delete and Audit](#stage-3a-soft-delete-and-audit)
6. [Stage 3b: Own Login and Routes](#stage-3b-own-login-and-routes)
7. [Stage 3c: Guided Onboarding](#stage-3c-guided-onboarding)
8. [Stage 3d: Landing and Legal Pages](#stage-3d-landing-and-legal-pages)
9. [Security](#security)
10. [Testing and Acceptance](#testing-and-acceptance)
11. [Open Questions](#open-questions)

---

## Overview

Today NotaFlow is closed. Cloudflare Access fronts the whole hostname, and a platform admin creates every account and links every user. A new company cannot start alone.

This RFC opens NotaFlow as a SaaS:

- **Own login** with Better Auth, a TypeScript library that runs inside the server: e-mail code, Google, e-mail and password, and passkey. Cloudflare Access leaves the hostname.
- **Open signup** and a **guided onboarding** in a timeline. The steps are: account, company name, CNPJ card, digital certificate, an optional fiscal configuration, automatic sync, and a tour.
- **New routes:** a public landing page at `/`, signup and login pages, and the logged-in app under `/app`.
- **Nothing is deleted:** every business table gets soft delete and audit columns, enforced by the database.

## Goals and Non-Goals

**Goals**

- A company signs up, proves it owns its CNPJ with its certificate, and syncs its invoices without help.
- The four login methods work for every user, with the same accounts and data for the current users.
- No business row is ever deleted; every change carries who and when.
- A public landing page presents the product and leads to signup.

**Non-goals**

- Plans, prices, and billing. They are a later stage; the landing page says the product is free for now.
- A second factor for platform admins. Admins use the same login as customers (decision below).
- Reading CNPJ cards from photos with OCR. A card that is not a text PDF falls back to the CNPJ typed by the user.

## Decisions

From the design session with Lincoln on 2026-10-10:

| Topic | Decision |
| --- | --- |
| Who signs up | Anyone: an open SaaS, without invitation or approval. |
| Login methods | E-mail code, Google, e-mail and password, and passkey. |
| Login provider | Better Auth inside the server (approach A). Cloudflare keeps the tunnel, the WAF, and Turnstile; Access leaves the hostname. Managed services (Clerk, Auth0, WorkOS) were rejected for the per-user cost and the data outside; Access was rejected for the 50-seat free limit, no password or passkey, and a login page outside the product. |
| E-mail | Resend, from `nao-responda@notaflow.vapulab.com`, with no reply address; the e-mails say they must not be answered. The domain is verified with DNS records under sub-names, so they do not conflict with the tunnel CNAME or the Hostinger mail of `vapulab.com`. |
| Company data | CNPJ card upload plus a public lookup by CNPJ (BrasilAPI). The card is stored as a document; the lookup completes and checks it, including the Simples option. |
| Fiscal configuration | An optional onboarding step, suggested by the lookup; the tour reminds the user before the first invoice without a template. |
| Platform admin | The same login as customers; the `platform_role` in the database decides. |
| Billing | Not now. The landing page says "free for now". |
| Several emitters | An account can have many emitters; a CNPJ belongs to one account only. Onboarding creates the first one. |
| Ephemeral auth secrets | Sessions and one-time codes may be deleted on expiry or logout; the audit log keeps every login, code sent, and logout. Every other table is soft delete only. |
| Personal data erasure (LGPD) | Anonymize the personal fields and keep the row. Invoices are kept as tax records. |

## Delivery Order

Four stages, each with its own plan, PR, and deploy:

1. **3a: Soft delete and audit.** The foundation; nothing visible changes.
2. **3b: Own login and routes.** Better Auth, the new routes, the account page. Access leaves the hostname at the end, after acceptance in production.
3. **3c: Guided onboarding.** The timeline, CNPJ card and lookup, certificate check, sync, and tour.
4. **3d: Landing and legal pages.** It can run alongside 3c.

## Stage 3a: Soft Delete and Audit

**Columns.** Every business table has `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, and `deleted_by`:

- The business tables are accounts, users, memberships, emitters, certificates, customers, services, invoices, invoice_events, and sync_state.
- Each `*_by` column is a user id. Null means the system, such as the sync or the scheduler.
- Existing rows get `updated_at = created_at`.

**No delete, enforced by the database.**

- A `BEFORE DELETE` trigger on each business table aborts with `RAISE(ABORT, 'soft delete only')`.
- Removing a row sets `deleted_at` and `deleted_by`.
- Repositories read through one `notDeleted(table)` filter. A test runs every repository read against a soft-deleted row.
- Unique indexes become partial (`WHERE deleted_at IS NULL`). For example, an e-mail whose user was removed can sign up again.

**`archived` stays.** Archiving a customer or a service is a user choice the user reverts; `deleted_at` is a removal that only a platform admin reverts.

**Audit log.**

- It is append only: a trigger refuses `UPDATE` and `DELETE`.
- It gains `ip`, `user_agent`, and `request_id`.
- It records every auth event: signup, login (with the method), logout, code sent, failed attempt, password changed or reset, passkey added or removed, Google linked, and terms accepted.

**Exceptions.** The Better Auth `session` and `verification` tables hold ephemeral secrets (session tokens, one-time codes). They keep their own lifecycle: deleted on expiry or logout.

**Erasure (LGPD).** An erasure request replaces the user's name, e-mail, and phone with an anonymous value, sets `deleted_at`, and is audited. Invoices and their XML stay, because tax law requires them for at least 5 years.

## Stage 3b: Own Login and Routes

**Better Auth in the server.**

- It is mounted at `/api/auth/*` in Fastify, with the Drizzle SQLite adapter.
- Its `user` model maps to the existing `users` table, plus its own `session`, `account`, `verification`, and `passkey` tables.
- The current users keep their ids. The first login by e-mail code lands in the same user, with the same accounts, emitters, and invoices.

| Method | Behavior |
| --- | --- |
| E-mail code | 6 digits, valid 10 minutes, at most 5 tries. It signs up, logs in, and verifies the e-mail. |
| Google | OAuth. It links to an existing user only when Google says the e-mail is verified. |
| E-mail and password | At least 10 characters. A password found in known breaches is refused (Have I Been Pwned, k-anonymity). Reset by e-mail code. |
| Passkey | Added in the account page after a login; then it logs in alone. |

**Sessions.**

- The session is an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
- It lasts 30 days and renews with use.
- "Sair de todos os dispositivos" ends every session.

**Guards.** `authHook` reads the Better Auth session instead of the Cloudflare Access JWT. `identityOf`, `accountContext`, `adminContext`, and the route sweep do not change. `AUTH_MODE=dev` stays for local work.

**Abuse limits.**

- Better Auth rate limits on the auth routes.
- Cloudflare Turnstile on signup, code sending, and password reset.
- A per-IP limit on new accounts per day.

**E-mail.** Resend sends the code, the reset, and the welcome e-mails. They are in Portuguese, in the Malphas look, and the footer says they are not answered.

**Account page (`/app/conta`).** It has name, password, passkeys, linked Google, active sessions, and "sair de todos os dispositivos".

**Routes.** The web moves from hash routes to path routes. The server serves the SPA for every non-API path except the landing and legal pages.

| Path | Screen |
| --- | --- |
| `/` | Landing page (stage 3d; until then it redirects to `/entrar`) |
| `/cadastro`, `/entrar`, `/recuperar-senha` | Signup, login, password reset |
| `/app/comecar` | Onboarding timeline (stage 3c) |
| `/app` and below | Dashboard and the current screens: `/app/notas`, `/app/notas/nova`, `/app/notas/:id`, `/app/clientes`, `/app/emitentes`, `/app/membros`, `/app/conta` |
| `/admin` | Platform admin |
| `/termos`, `/privacidade` | Legal pages (stage 3d) |

An old link (`/#/a/:account/...`) redirects to its new path.

**Cut-over in production.**

1. Deploy with Access still on: only Lincoln and Diogo reach the new login. Accept the four methods in production.
2. Delete the Access application of the hostname: the site becomes public.
3. The "Sair" link calls the Better Auth sign-out instead of `/cdn-cgi/access/logout`.

## Stage 3c: Guided Onboarding

A timeline at `/app/comecar`:

- vertical on desktop, stacked on a phone, built from Malphas components;
- each step shows a title, a one-line instruction, and a state (done, current, to do);
- the step of an account is stored (`accounts.onboarding_step`), so a user who leaves comes back to it;
- `/app` redirects there until onboarding is done.

1. **Create the account.** E-mail code, Google, or password.
2. **Company name.** The account name, editable later.
3. **CNPJ card.**
   - **Read the card.** The user uploads the card (PDF, at most 2 MB). The server extracts the text of a text PDF and reads CNPJ, legal name, trade name, address, municipality and state, CNAE, and registration status.
   - **Look up the CNPJ.** BrasilAPI completes the IBGE municipality code, the Simples option, and the MEI option.
   - **Check.** A status other than "Ativa" stops the step with its reason.
   - **Fall back.** A card that cannot be read asks for the CNPJ typed, and the lookup fills the data.
   - **Confirm.** A "Confira os dados" panel shows the result, with the municipal registration to type.
   - The card is stored as an account document, gzipped, with soft delete.
4. **Digital certificate.**
   - The user sends an A1 `.pfx` and its password.
   - The server checks its validity and that **its CNPJ equals the card's CNPJ**: the certificate proves the user owns the company. It tests the connection to the Sefin and seals the certificate in the vault, as today.
   - A CNPJ that already has an emitter in another account is refused, as today.
   - Every technical field is automatic, with a default under "Opções avançadas":
     - the municipality comes from the lookup;
     - the Simples option comes from the lookup: an ME/EPP optant is 3, a MEI is 2, and anything else is 1;
     - the Simples regime defaults to 1;
     - the special regime defaults to 0;
     - the DPS series has a default.
5. **Fiscal configuration (optional).** Annex, band, and ISS, suggested by the lookup, with "Fazer depois".
6. **Sync.** It starts alone and shows a counter of imported invoices. The user goes on to the dashboard while it runs.
7. **Tour.** On the first dashboard visit, driver.js highlights:
   - Nova nota, Notas, Emitir parecida, Clientes, and Emitentes;
   - the fiscal configuration, when it was skipped.

   The tour can be replayed from the user menu.

**Invited users.** A user who joins an account by invitation skips onboarding.

**More emitters.** A second emitter goes through steps 3 to 6 from the Emitentes page.

**Environment.** Onboarding is always in production; produção restrita stays a platform admin tool.

## Stage 3d: Landing and Legal Pages

**Landing at `/`.**

- Static HTML built by Vite as its own entry, fast and indexable, with title, description, and Open Graph image.
- The Malphas theme, in light and dark.

The page has these sections:

| Section | Content |
| --- | --- |
| Hero | What NotaFlow does, in one sentence, and "Criar conta grátis". |
| How it works | The onboarding steps. |
| Features | New invoice in simple or complete mode, issue similar, export with automatic PTAX, import from the national system, cancel, many companies, team roles. |
| Security | The certificate is sealed, nothing is deleted, and an audit trail exists. No claim the code cannot prove. |
| FAQ | Who it is for (Simples Nacional), which certificate (A1), and the price ("gratuito por enquanto"). |
| Footer | Terms, privacy, and contact. |

**Legal pages.**

- `/termos` and `/privacidade` are drafted by Claude in Portuguese and reviewed with a skill specialized in Brazilian law and case law (LGPD, Marco Civil da Internet, CDC). Lincoln makes the final review, ideally with a lawyer, before launch.
- Signup asks to accept both. The acceptance is stored with the date and the document version, and audited.

**Copy.** All landing copy is drafted in Portuguese and reviewed by Lincoln.

## Security

- **Ownership.** The certificate's CNPJ must equal the CNPJ card's. A signup cannot take over a company it does not hold a certificate for.
- **Uploads.**
  - Card PDFs are limited in size and parsed in a worker with a timeout.
  - The text extraction never runs scripts.
  - Certificates keep the vault rules.
- **Public surface.**
  - Every `/api` route except `/api/health`, `/api/auth/*`, and the landing assets needs a session.
  - The route sweep covers the new routes.
- **Cookies and CSRF.** The session cookie is `SameSite=Lax`; the existing Origin check stays on every state-changing request.
- **Secrets.** These are deploy secrets: `BETTER_AUTH_SECRET`, the Resend API key, the Google OAuth client secret, and the Turnstile secret. They are never in git.
- **Lookup outage.** When BrasilAPI does not answer, the step says so and lets the user retry. Onboarding does not guess the Simples option.

## Testing and Acceptance

- **3a:**
  - A test per business table: `DELETE` is refused.
  - A soft-deleted row is invisible to every repository read.
  - Partial unique indexes let a removed e-mail sign up again.
  - The audit log refuses `UPDATE`.
- **3b:**
  - Each login method works end to end against a test Better Auth instance with a fake mailer and a stubbed Google provider.
  - The current users keep their ids and memberships.
  - The route sweep covers `/api/auth/*`.
  - Acceptance in production follows the cut-over steps.
- **3c:**
  - The card parser runs on synthetic text PDFs built in the test, never a real card in git.
  - The BrasilAPI client is tested with a mock agent.
  - A certificate whose CNPJ differs from the card's is refused.
  - A browser acceptance covers signup to dashboard against the fake Sefin.
- **3d:**
  - The landing builds as static HTML and passes a link check.
  - Checks at phone and desktop width, in light and dark mode.

## Open Questions

- [ ] BrasilAPI CNPJ fields and limits. A spike confirms that the answer has the IBGE municipality code and the Simples and MEI options, and its rate limits. A second public source is a fallback.
- [ ] The card layout. Two or three real cards of Lincoln's companies, read locally and never committed, confirm the text PDF layout of the Receita site.
- [x] Better Auth versions and plugins: `better-auth@1.7.7` and `@better-auth/passkey@1.7.7`, with the plugins `emailOTP`, `haveIBeenPwned`, `captcha` (Turnstile), and `passkey`, on the Drizzle SQLite adapter.
- [ ] Google OAuth consent screen: app name, logo, the privacy and terms URLs, and whether Google verification is needed for the scopes `openid email profile`.
- [ ] The default DPS series for a new emitter.
- [ ] Legal texts: a review with a Brazilian law skill (to find at stage 3d; if none is installed, recommend one), then Lincoln's review and a lawyer.
