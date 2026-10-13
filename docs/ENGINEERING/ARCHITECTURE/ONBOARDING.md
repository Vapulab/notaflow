# Onboarding

A company signs up alone, at `/app/comecar`. It names its account, sends its CNPJ card and its A1 certificate, can set the fiscal configuration, and watches its invoices sync. On the first visit to the dashboard, a tour shows the main places.

## Steps

`accounts.onboarding_step` holds where an account is: `card`, `certificate`, `fiscal`, `sync`, or `done`. (`company` is the timeline step before an account exists; it is never stored.)

| Step | Route (owner) | Moves to |
| --- | --- | --- |
| Company name | `POST /api/onboarding/account` (a user with no account) | `card` |
| CNPJ card | `POST /api/accounts/:id/onboarding/card`, or `.../onboarding/cnpj` (typed CNPJ) | `certificate` |
| "Trocar cartão" | `POST .../onboarding/back-to-card` | `card` |
| Certificate | `POST .../onboarding/certificate` | `fiscal` (the first sync starts) |
| Fiscal configuration | the emitter's fiscal route, then `POST .../onboarding/fiscal-done` | `sync` |
| Sync | `POST .../onboarding/finish` | `done` |

- **A step moves only from the step it expects** (`OnboardingRepository.advance`, a compare-and-set). A repeated or late request answers 409 `onboarding_step` with the current step.
- **An account that had an emitter before stage 3c is `done`.** A new account, from signup or from the admin panel, starts at `card`.
- **The home page sends an owner** with no account, or with one unfinished account, to the current step. A member of an unfinished account waits for the owner.

## The CNPJ card

- **Reading** (`src/onboarding/cardReader.ts`):
  - a PDF of at most 2 MB;
  - pdf.js (through `unpdf`) extracts the text in a child process (`cardProcess.ts`) with a 128 MB heap, killed after 10 seconds, so a hostile PDF cannot exhaust the server;
  - at most two cards are read at once; a third answers 503 `card_busy`;
  - a text over 64 kB is refused (a real card has about 2 kB);
  - the bundled pdf.js 6 has no eval path.
- **Limit:** 10 card or CNPJ lookups an hour per account (429 `too_many_lookups`).
- **What the parser takes:** the CNPJ (alphanumeric allowed, as the Receita issues since 2026) and the legal name (the line after `NOME EMPRESARIAL`). A different name from the lookup is flagged, not refused.
- **Storage:** the card waits on the account (`accounts.cnpj_draft_card`, one at a time) and moves to `account_documents`, gzipped, with its SHA-256, only when the certificate proves the company.
- **Card layout check:** `pnpm tsx apps/server/scripts/cardLabels.ts <card.pdf>` checks a real card locally and prints only which labels it found.

## The public lookup

`src/onboarding/cnpjLookup.ts` asks BrasilAPI (`/api/cnpj/v1/{cnpj}`) first. On a 5xx, a 429, or a timeout of 8 seconds, it asks CNPJá open (`/office/{cnpj}`).

- **Both down:** 502 `cnpj_lookup_unavailable`. Nothing is guessed.
- **Not active:** a status other than "ATIVA" answers 422 `cnpj_not_active`, with the status.
- **The Simples option** (`opSimpNac`): MEI is `2`, a Simples optant that is not MEI is `3`, anything else is `1`.

## Ownership

The certificate's CNPJ must equal the card's (409 `certificate_cnpj_mismatch`), so a signup cannot take a company it holds no certificate for. The card step already refuses:

- a CNPJ that is an emitter in another account;
- a CNPJ that belongs to a removed emitter;
- a CNPJ that is already an emitter of this account.

The first refusal tells an account that a CNPJ is a NotaFlow customer. The lookup limit bounds that, and the certificate step stays the real proof.

## Another emitter

A finished account adds more emitters from Emitentes, through `POST /api/accounts/:id/emitters/new/card`, `.../new/cnpj`, and `.../new/certificate`. These run the same checks, store the draft in `accounts.cnpj_draft`, and leave `onboarding_step` at `done`. The emitter creation itself is `EmitterOnboarding` (`src/emitters/EmitterOnboarding.ts`), shared with `POST .../emitters`.

## The tour

`apps/web/src/tour/tour.ts` uses driver.js on the home page cards: Nova nota, Notas (with "Emitir parecida"), Clientes, and Emitentes. It adds a step on the fiscal configuration when `/api/me` reports `needsFiscalConfig`.

- **First visit:** the tour runs when `users.tour_seen_at` is null. Closing or finishing it calls `POST /api/me/tour-seen`.
- **Again:** "Ver o tour" in the header opens `/app?tour=1`.

## Reminders

An owner whose onboarding stops gets up to two reminder e-mails, on day 1 and day 4 after the account was created. The copy follows the step where the account stopped: the CNPJ card, the certificate, or the revenue. After onboarding ends (`accounts.onboarding_done_at`), an account with no production invoice issued by NotaFlow gets two more, on day 3 and day 7. The `LifecycleService` sends them, together with the reactivation e-mails; see the [Lifecycle E-mails RFC](../RFCS/2026/10/RFC_LIFECYCLE_EMAILS.md).

## Signup source

The `utm_*` of the link that brought a person stay on the user as `signup_source`, `signup_medium`, and `signup_campaign`. Only the first source counts.

- **Landing page:** `carryCampaign` (`apps/web/src/analytics/source.ts`) copies the `utm_*` of the address to the `/cadastro` and `/entrar` links. The pages pass them on to each other.
- **Password signup and code login:** the web app sends them in the `x-notaflow-source` header.
- **Google:** they ride the OAuth state as `additionalData.signupSource`. `newUserCallbackURL` brings a new user back to `/app?cadastro=google`, so the app knows the login created the user.
- **Server:** the `user.create` hook in `betterAuth.ts` reads the header or the OAuth state. `parseSignupSource` keeps only lowercase slugs of up to 100 characters; anything else is dropped.
- **PostHog:** `signup_completed` carries `method` (`password` or `google`) and the `utm_*`. A code login that creates a user sends no event; the database still has its source.

Signups by source, on the VPS:

```sh
docker exec -w /repo/apps/server notaflow-app-1 node -e "const D=require('better-sqlite3');const db=new D(process.env.DATABASE_PATH,{readonly:true});console.table(db.prepare('select signup_source, signup_medium, signup_campaign, count(*) n, sum(email_verified) verified from users group by 1,2,3 order by n desc').all())"
```
