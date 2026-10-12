# RFC: Lifecycle E-mails and Policy Notices

**Status:** Approved in design (2026-10-12), with the legal review below; plan to follow
**Date:** 2026-10-12
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [SaaS Signup RFC](RFC_SAAS_SIGNUP.md) (signup, onboarding steps, legal acceptance)
- [Monitoring RFC](RFC_MONITORING.md) (business metrics and the Grafana panel)
- [Onboarding](../../../ARCHITECTURE/ONBOARDING.md)
- RFC 8058, one-click unsubscribe: <https://www.rfc-editor.org/rfc/rfc8058>
- Gmail sender guidelines: <https://support.google.com/a/answer/81126>

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution](#solution)
4. [Design](#design)
5. [Data Model](#data-model)
6. [File Locations](#file-locations)
7. [Testing](#testing)
8. [Open Questions](#open-questions)

---

## Overview

NotaFlow sends e-mails that bring a person back at three moments: when onboarding stops, when onboarding ends but no invoice follows, and when invoices stop. The welcome e-mail becomes a real guide to the first invoice. A service inside the API server decides who gets which e-mail and sends it through the existing mail outbox.

The same work changes how a privacy policy update reaches users. Today every change blocks the app until the user accepts again. After this RFC, only a material change blocks the app; any other update shows a notice once. Because our terms already promise acceptance and 15 days of notice for any change to the processing of data, this new rule ships as one last material change, and the reminders start 15 days after it.

---

## Problem Statement

- **Onboarding drops silently.** An account can stop at the CNPJ card, the certificate, or the revenue step, and nothing reminds the owner. Production has 3 accounts and 1 emitter: most signups did not finish.
- **No first invoice.** An account can finish onboarding and never issue. Nothing points the owner to the next step.
- **Inactivity is invisible.** A company that stops issuing through NotaFlow gets no contact.
- **The welcome e-mail says one line:** "Sua conta no NotaFlow está pronta."
- **Re-acceptance fatigue.** The legal version changed three times in two days (2026-10-11, 2026-10-11.2, 2026-10-12). Each change blocked the app for every user. The acceptances are stored correctly; the rule of when to ask is too strict. The lifecycle e-mails need one more policy change, which would block everyone again.

---

## Solution

| Decision | Choice | Why |
| --- | --- | --- |
| Who sends | A `LifecycleService` in the API server, on the existing scheduler, through the mail outbox | No new vendor, no personal data leaves, rules read the database directly. Copy changes need a deploy. |
| Inactive means | No invoice issued by NotaFlow in production for N days | It measures real use; a person who only logs in to look is still inactive. |
| Cadence | Moderate: at most 2 e-mails per phase | Lincoln's choice. |
| Recipients | Owners of the account (role `owner`) | Invited members did not choose the product. |
| When | Business days, 09:00 to 17:00 America/Sao_Paulo; at most one lifecycle e-mail per person per day | Less noise. |
| Opt-out | Signed link, confirm page, RFC 8058 one-click, and a profile toggle | Required by the Gmail and Yahoo sender rules and by good practice under the LGPD. |
| Policy changes | `material` changes block the app for acceptance; `update` changes show a notice once. The new rule is written into the change clauses of the terms and the policy. | The legal bases are contract and legitimate interest, not consent, so an update needs notice, not acceptance. To confirm with the lawyer. |
| First release | One last `material` version: the new change clauses and the reminders section. Announced by e-mail and in the app on the day of the deploy; reminders start 15 days later (`LIFECYCLE_START_AT`) and only for users who accepted it | The current terms (clause 14) and policy (section 10) promise acceptance and 15 days of notice for a change to the processing of data. The PostHog recordings and Sentry changes skipped the 15 days; this release does not. |

---

## Design

### The phases

| Phase | Starts when | Anchor | E-mails |
| --- | --- | --- | --- |
| `activation` | The account exists and onboarding is not `done` | `accounts.created_at` | Day 1 and day 4; the copy follows the step where the account stopped (`card`, `certificate`, `fiscal`) |
| `first_invoice` | Onboarding is `done` and no invoice with `origin = app` exists in `producao` | `accounts.onboarding_done_at` | Day 3 and day 7 |
| `reactivation` | The account has an invoice with `origin = app` in `producao` | The `issued_at` of the newest such invoice | Day 45 and day 90 |

The `company` and `sync` steps count as `card` and `fiscal` for the copy: `company` comes before the card, and `sync` runs on its own after the fiscal step.

A new invoice changes the `reactivation` anchor, so a later long pause starts a new cycle. An account in the `first_invoice` or `reactivation` phase never gets `activation` e-mails.

### The service

`LifecycleService.runDue(now)` runs every 15 minutes through `startScheduler` in `main.ts`. Each run:

1. Returns at once before `LIFECYCLE_START_AT` (config, an ISO date; unset means never) or outside business hours (Monday to Friday, 09:00 to 17:00 America/Sao_Paulo).
2. Reads the candidates through `LifecycleRepository`. This repository has platform scope, like `MetricsRepository`: it reads across accounts and returns only ids, the step, and the anchor.
3. For each candidate owner, picks the step that is due: the highest step whose day has passed and that has no row in `lifecycle_emails` for the same user, account, phase, and anchor.
4. Skips the owner when:
   - the account is suspended or deleted, or the user is deleted;
   - the user opted out (`users.lifecycle_opt_out_at` is set);
   - the user has not accepted the `LEGAL_VERSION` of this release or a later one;
   - the user got a lifecycle e-mail since 00:00 America/Sao_Paulo today;
   - the anchor is more than 120 days old.
5. In one transaction, inserts the `lifecycle_emails` row and the `mail_outbox` row (kind `lifecycle`). The unique index on `lifecycle_emails` stops a second run from sending again.

The "highest due step" rule means an old account gets only its latest reminder after the first deploy, never step 1 when step 2 is due.

### The e-mails

| E-mail | Subject | Content |
| --- | --- | --- |
| Welcome (kind `welcome`, at signup) | Boas-vindas ao NotaFlow: sua primeira nota em 4 passos | What NotaFlow is and that it is free; the 4 steps; what to have at hand (CNPJ card, A1 certificate, revenue of the last 12 months); a "Continuar o cadastro" button |
| Activation, card, 1 | Falta só o cartão CNPJ | Where to download the card at the Receita site; NotaFlow reads the data |
| Activation, card, 2 | Precisa de ajuda com o cadastro? | Short help; "responda este e-mail com a sua dúvida" |
| Activation, certificate, 1 | Falta o certificado digital A1 | What an e-CNPJ A1 is, where to buy it (a certification authority), that an A3 token does not work, that the file stays encrypted |
| Activation, certificate, 2 | Seu certificado A1 já chegou? | Short reminder and an invitation to reply |
| Activation, fiscal, 1 | Último passo: a receita dos últimos 12 meses | Why it sets the Simples rate; where to find it (the Simples statement or the accountant) |
| Activation, fiscal, 2 | Sua conta está quase pronta | Short reminder |
| First invoice, 1 | Tudo pronto para a sua primeira nota | How to issue; imported invoices can be copied with "emitir parecida" |
| First invoice, 2 | Sua primeira nota pelo NotaFlow | Short reminder; the export case with PTAX |
| Reactivation, 1 (45 days) | Suas notas continuam aqui | The rate by the law, issue similar, cancel with a record; an "Emitir uma nota" button |
| Reactivation, 2 (90 days) | Ainda emitindo notas de serviço? | Last contact; "se o NotaFlow não serviu, conte para a gente o porquê" |

Rules for all lifecycle e-mails:

- From `NotaFlow <nao-responda@notaflow.vapulab.com>`, with `Reply-To: contato@vapulab.com`. The footer invites a reply instead of "não recebe respostas".
- The footer has the opt-out link. The headers are `List-Unsubscribe: <https://notaflow.vapulab.com/api/public/lifecycle/unsubscribe?...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- The same layout and inline styles as the current templates, and a plain-text part.
- Lincoln approves the final text of every e-mail before the merge.

The welcome e-mail stays a service e-mail: no opt-out link, sent to every new user at signup as today.

### Opt-out

- The link carries the user id and an HMAC-SHA256 of it, with a key derived from `BETTER_AUTH_SECRET` and the label `lifecycle-unsubscribe`. No login is needed, and nobody can opt out another person.
- `GET /api/public/lifecycle/unsubscribe` answers a small HTML page with a "Confirmar" button. A mail scanner that opens links does not opt anybody out.
- `POST` on the same path, with the same parameters, sets `users.lifecycle_opt_out_at`. Gmail and Yahoo call it for one-click unsubscribe.
- An opt-out also cancels that user's lifecycle e-mails still waiting in the outbox: their status becomes `cancelled` (rows are never deleted). The outbox never sends a `cancelled` row. The objection takes effect at once (LGPD, art. 18, § 2).
- The profile page has a toggle "Receber lembretes e dicas por e-mail". It clears or sets the same column through `PUT /api/me/preferences`.

### Policy notices

- `apps/server/src/legal.ts` keeps `LEGAL_VERSION` for the version that needs acceptance and adds `POLICY_NOTICE`: an id, a date, one sentence of what changed, and the link.
- `GET /api/me` adds `policyNotice: { id, date, text, href } | null`. It is null when the user already saw that notice or accepted a later version.
- The app shows a thin banner on every screen of the app, once, with the link and an "Entendi" button. `POST /api/me/policy-notice` records the view in `policy_notice_views` and in the audit log.
- `LegalGate` and the acceptance flow stay as they are, for material changes only.
- This RFC's own policy change ships as the last `material` change (see "First release"). The first `update` is the next policy change after it.

### Terms and privacy policy

The release changes three texts and gets a new `LEGAL_VERSION`:

- **Terms, clause 14, and policy, section 10 (changes):** a material change reduces rights, changes the price, or adds a purpose not compatible with the service. It is announced by e-mail and in the app at least 15 days before it applies, and it needs acceptance. Any other change (a clarification, a new provider for the same purpose, a communication about the use of the service with opt-out) is an update: it applies when published and is shown in the app.
- **Policy, new section "E-mails sobre o uso do NotaFlow":** reminders during onboarding, before the first invoice, and after a long pause; the legal basis (legitimate interest, art. 7, IX); only to account owners; the opt-out link and the profile toggle; replies to contato@vapulab.com, which can hold personal data; the retention of `lifecycle_emails` for 5 years after the account ends, as proof that each objection was respected.
- **Policy, Resend:** it sends "os e-mails de código, de recuperação de senha, de convite, de boas-vindas e de lembretes".

On the day of the deploy, a one-off command sends every user a `notice` e-mail with what changes and the date the reminders start.

### Legitimate interest assessment

A short record, following the ANPD guide on legitimate interest (2024):

| Step | Assessment |
| --- | --- |
| Purpose | Help the owner finish onboarding, issue the first invoice, and come back to a service they chose. Legitimate and concrete. |
| Necessity | Only the owner's e-mail, name, onboarding step, and the date of the last invoice. No invoice content, no customer data, no tracking pixel. |
| Expectation | The owner signed up for this service; e-mails about its use are expected. Invited members get none. |
| Impact | At most 2 e-mails per phase, at most 1 per day, business hours only. |
| Safeguards | Opt-out in every e-mail and in the profile, effective at once; RFC 8058 headers; the policy section; 120-day cut-off; the record of every send. |
| Conclusion | The legitimate interest holds, with the safeguards above. |

### Metrics and diagrams

- A gauge `notaflow_lifecycle_emails{phase, step}` reads the counts from `lifecycle_emails`. The "5. Negócio" panel gets a row with the e-mails sent per phase.
- The C4 component diagram of the server gets the `LifecycleService`.

---

## Data Model

New migration:

```sql
ALTER TABLE accounts ADD COLUMN onboarding_done_at INTEGER; -- ms; set when the step becomes 'done'
ALTER TABLE users ADD COLUMN lifecycle_opt_out_at INTEGER;  -- ms; null means the user gets reminders

CREATE TABLE lifecycle_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  phase TEXT NOT NULL,       -- 'activation' | 'first_invoice' | 'reactivation'
  step INTEGER NOT NULL,     -- 1 | 2
  variant TEXT NOT NULL,     -- 'card' | 'certificate' | 'fiscal' | '' (the copy that was sent)
  anchor_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX lifecycle_emails_once ON lifecycle_emails (user_id, account_id, phase, step, anchor_at);

CREATE TABLE policy_notice_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  notice_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX policy_notice_views_once ON policy_notice_views (user_id, notice_id);
```

- Both new tables are append-only and get the `no_delete` trigger, like `legal_acceptances`.
- The backfill sets `onboarding_done_at` of every `done` account to the `created_at` of its oldest emitter.
- `mail_outbox.kind` and `MailKind` get the value `lifecycle`; `mail_outbox.status` gets the value `cancelled`.
- `MailMessage` gets optional `replyTo` and `headers`, which the Resend mailer passes through.

---

## File Locations

| File | Purpose |
| --- | --- |
| `apps/server/src/lifecycle/LifecycleService.ts` | `runDue(now)`: business hours, due step, skips, send |
| `apps/server/src/lifecycle/schedule.ts` | The phases, their days, and the business-hours check (pure functions) |
| `apps/server/src/lifecycle/unsubscribe.ts` | Token sign and verify; the public routes |
| `apps/server/src/repos/LifecycleRepository.ts` | Platform-scope reads of the candidates; inserts of `lifecycle_emails` |
| `apps/server/src/mail/templates.ts` | The welcome e-mail and the lifecycle templates |
| `apps/server/src/legal.ts` | `LEGAL_VERSION` and `POLICY_NOTICE` |
| `apps/server/src/routes/me.ts` | `policyNotice`, `POST /api/me/policy-notice`, `PUT /api/me/preferences` |
| `apps/server/drizzle/0016_lifecycle.sql` | The migration and the backfill |
| `apps/web/src/components/PolicyNotice.tsx` | The banner |
| `apps/web/src/pages/ProfilePage.tsx` | The reminders toggle |
| `apps/web/privacidade.html` | The reminders section, the change section, and the Resend entry |
| `apps/web/termos.html` | Clause 14, the new change rule |
| `apps/server/src/config.ts` | `LIFECYCLE_START_AT` |
| `apps/server/src/policyNotice.ts` (script `pnpm notice:legal`) | The one-off `notice` e-mail to every user on the day of the release |
| `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-3-server-components.*` | The new component |

---

## Testing

Tests come first, with a fixed clock:

- **Phases:** each day (1, 4, 3, 7, 45, 90) triggers at its time and only for owners. Suspended, deleted, ownerless, and opted-out accounts and users get nothing.
- **Once:** two runs in a row send once. A new invoice starts a new `reactivation` cycle.
- **First deploy:** an old account gets only its latest due step, and nothing after 120 days.
- **Hours:** nothing leaves outside business days from 09:00 to 17:00 America/Sao_Paulo; at most one lifecycle e-mail per person per day.
- **Opt-out:** a valid token opts out; a changed token or another user's token is refused; the GET page changes nothing; the one-click POST works; the profile toggle reverts it; a queued lifecycle e-mail becomes `cancelled` and is never sent.
- **Start and acceptance:** nothing leaves before `LIFECYCLE_START_AT`, and nothing goes to a user who has not accepted the release's `LEGAL_VERSION`.
- **Notice:** it shows once, "Entendi" records it, and it never blocks the app.
- **Copy:** every link goes to a page that exists; every lifecycle e-mail has the opt-out link and the headers; no placeholder is left.

---

## Open Questions

- [ ] Lawyer: is the new change clause (material change with acceptance and 15 days, update with notice) valid for a free B2B service whose bases are contract and legitimate interest? Do usage reminders by e-mail, with opt-out, fit the legitimate interest of art. 7, IX, for the account owner?
- [ ] Lincoln approves the final text of every e-mail before the merge.
