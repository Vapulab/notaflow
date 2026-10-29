# Invoice E-mail Bounces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resend reports bounces and complaints of invoice e-mail to a signed webhook. A permanent bounce blocks the address and shows "endereço inválido". A complaint blocks the address in silence. The emitter can correct the address, or unblock it once in 30 days.

**Architecture:** The outbox stores the Resend e-mail id of each send. `POST /webhooks/resend` verifies the Svix signature, finds the outbox row by that id, marks its delivery, and writes a reasoned suppression. `InvoiceMailer` refuses a bounce-blocked address with 409 and unblocks it on `confirmAddress`, also on Resend's side. The invoice API derives `customerEmailProblem` from the latest invoice outbox row.

**Tech Stack:** Fastify, drizzle + SQLite, undici, node:crypto, prom-client, React, Vitest.

**Spec:** `docs/ENGINEERING/RFCS/2026/10/RFC_MAIL_BOUNCES.md`

## Global Constraints

- Rules of `AGENTS.md` apply: no `!` assertions, comments one line and only the non-obvious why, no em dash, no AI attribution, never delete a row (`softDelete`, `notDeleted`).
- No log line, audit detail, metric label, or Sentry report keeps a full e-mail address or the webhook body. Audit and log keep the domain only (`@domain`).
- UI text in Brazilian Portuguese, exact copy below. Code and comments in English.
- A schema change has its migration in the same commit: `pnpm --filter @notaflow/server exec drizzle-kit generate --name <name>`.
- Env names: `RESEND_WEBHOOK_SECRET` (new), `RESEND_API_KEY` (exists, Full access since 2026-10-29).
- Webhook path `/webhooks/resend`; signature tolerance 5 minutes; unblock window 30 days.
- Exact UI copy:
  - Invoice page: `E-mail não entregue: endereço inválido (<address>)`
  - 409 `email_invalid_address`: `Este endereço já recusou um e-mail do NotaFlow. Confira se está certo.`
  - Unblock button: `O endereço está certo, enviar mesmo assim`
  - 409 `email_invalid_address_final`: `Este endereço recusou o e-mail de novo. Use outro endereço.`
  - 502 `email_unblock_failed`: `Não foi possível desbloquear o endereço agora. Tente de novo em alguns minutos.`

## Review Focus

1. Address case and spaces: `Pessoa@Example.com ` bounced, then a send to `pessoa@example.com` is blocked too. Every lookup normalizes with `trim().toLowerCase()` (Task 1 test).
2. A Resend notice for an e-mail sent before this release (row without `provider_id`) or for a login code answers 200 and changes nothing (Task 3 test).
3. A complaint after a bounce on the same address: the reason becomes `complaint`, and `confirmAddress` then cannot unblock it (Task 1 and Task 4 tests).
4. The dialog after a 409: the emitter edits the address field; the unblock button must disappear, so a corrected address is not sent with `confirmAddress` (Task 5 test).
5. A malformed or truncated webhook body with a valid signature answers 400 and never throws a 500 (Task 3 test).

---

### Task 1: Schema and reasoned suppressions

**Files:**
- Modify: `apps/server/src/db/schema.ts` (`mailOutbox`, `mailSuppressions`)
- Create: `apps/server/drizzle/0028_mail_bounces.sql` (generated) and its snapshot/journal entries
- Modify: `apps/server/src/repos/MailSuppressionRepository.ts`
- Test: `apps/server/src/repos/MailSuppressionRepository.test.ts` (create), `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces:
  - `mail_outbox.provider_id` text nullable, index `mail_outbox_provider_id`; `mail_outbox.delivery` text enum `['bounced', 'complained']` nullable. Drizzle names `providerId`, `delivery`.
  - `mail_suppressions.reason` text enum `['unsubscribe', 'bounce', 'complaint']` not null default `'unsubscribe'`. Drizzle name `reason`.
  - `type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint'` exported from the repository.
  - `add(address: string, kind: 'invoice', reason?: SuppressionReason): void` (default `'unsubscribe'`). An existing active row keeps its reason, except that `complaint` replaces `bounce`.
  - `reasonOf(address: string, kind: 'invoice'): SuppressionReason | null`
  - `isSuppressed` unchanged.
  - `unblockedRecently(address: string, kind: 'invoice', since: Date): boolean`: a soft-deleted `bounce` row with `deletedAt >= since`.
  - `unblock(address: string, kind: 'invoice', actor: Actor): boolean`: soft-deletes the active row only when its reason is `bounce`; returns whether it did.

- [ ] **Step 1: Write the failing tests** in `MailSuppressionRepository.test.ts` (in-memory database as other repo tests do):
  - `add without a reason stores unsubscribe` → `reasonOf('a@example.com','invoice')` is `'unsubscribe'`.
  - `a complaint replaces a bounce, a bounce does not replace a complaint or an unsubscribe`.
  - `lookups ignore case and spaces` → `add(' Pessoa@Example.com ','invoice','bounce')`, then `isSuppressed('pessoa@example.com','invoice')` is true and `reasonOf` is `'bounce'`.
  - `unblock lifts only a bounce` → returns true for a bounce row, false for a complaint row; after it, `isSuppressed` is false and `unblockedRecently(addr,'invoice', new Date(Date.now() - 30*86_400_000))` is true; with `since` in the future it is false.
  - In `migrations.test.ts`: an existing `mail_suppressions` row gets `reason = 'unsubscribe'` after the migration.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/repos/MailSuppressionRepository.test.ts src/db/migrations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Change the schema, generate the migration** (`--name mail_bounces`), and implement the repository methods. `unblock` uses `softDelete` from `db/stamps.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm --filter @notaflow/server exec tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(mail): reasons on the do-not-send list and delivery columns on the outbox`.

### Task 2: The outbox keeps the Resend id

**Files:**
- Modify: `apps/server/src/mail/mailer.ts`, `apps/server/src/mail/outbox.ts`
- Test: `apps/server/src/mail/mailer.test.ts`, `apps/server/src/mail/outbox.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `type Mailer = (message: MailMessage) => Promise<string | void>`: the Resend id when there is one. Existing fakes that return nothing stay valid.
  - `resendMailer` parses the 2xx JSON answer and returns its `id` when it is a string; a body that is not JSON returns nothing and does not throw.
  - `MailOutbox.attempt` stores the returned id in `providerId` on the `sent` update.
  - `MailOutbox.markDelivery(providerId: string, delivery: 'bounced' | 'complained'): { kind: MailKind; to: string } | null`: sets `delivery` on the row and returns it; null when no row has that id.
  - `MailOutbox.recordBlocked(message: { to: string; subject: string; ref: { accountId: string; invoiceId: string } }, now?: Date): void`: inserts a `kind 'invoice'`, `status 'cancelled'`, `delivery 'bounced'` row with empty `html` and `text`.
  - `MailOutbox.invoiceBounce(accountId: string, invoiceId: string): string | null`: the `to` of the latest invoice row of that invoice (highest `id`) when its `delivery` is `'bounced'`, else null.

- [ ] **Step 1: Write the failing tests:**
  - `mailer.test.ts`: `resendMailer returns the id from the Resend answer` (mock answer `{"id":"re_123"}` → resolves `'re_123'`); `a 2xx answer without JSON resolves with nothing`.
  - `outbox.test.ts`: `a sent row keeps the provider id` (transport resolves `'re_1'` → row `providerId === 're_1'`); `markDelivery marks the row and returns kind and to` and `returns null for an unknown id`; `invoiceBounce reads only the latest invoice row` (a bounced row then a newer sent row → null; a newer `recordBlocked` row → its `to`); `a recordBlocked row does not count in the caps` (`countInvoiceMail` unchanged).
- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/mail/mailer.test.ts src/mail/outbox.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `resendMailer`, replace `response.body.dump()` with reading the body as text and `JSON.parse` in a try.
- [ ] **Step 4: Run** the same command and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): keep the Resend id of each e-mail`.

### Task 3: The Resend webhook

**Files:**
- Create: `apps/server/src/mail/resendWebhook.ts`, `apps/server/src/mail/resendWebhook.test.ts`
- Modify: `apps/server/src/config.ts` (+ `config.test.ts`), `apps/server/src/app.ts`, `apps/server/src/metrics/metrics.ts`, `apps/server/.env.example`, `apps/server/src/observability/redact.ts` only if a test shows the path or body reaching a log

**Interfaces:**
- Consumes: `MailOutbox.markDelivery`, `MailOutbox.cancelPendingInvoice`, `MailSuppressionRepository.add`.
- Produces:
  - `config.mail.resendWebhookSecret: string | null` from `RESEND_WEBHOOK_SECRET`. A value that does not start with `whsec_` is a config problem.
  - `export const RESEND_WEBHOOK_PATH = '/webhooks/resend'`
  - `export function validSvixSignature(p: { id: unknown; timestamp: unknown; signature: unknown; body: Buffer; secret: string; now: Date }): boolean`. Signed content `${id}.${timestamp}.${body}`; key `Buffer.from(secret.slice('whsec_'.length), 'base64')`; HMAC-SHA256 in base64; the header holds space-separated `v1,<sig>` entries, any one matching passes, constant-time compare; `|now - timestamp*1000| > 300_000` fails.
  - `export function registerResendWebhook(app: FastifyInstance, deps: { secret: string | null; outbox: MailOutbox; suppressions: MailSuppressionRepository; metrics: Pick<Metrics, 'mailWebhookEvent'>; now?: () => Date }): void`, with a raw-body scope like `bugs/githubWebhook.ts`.
  - `Metrics.mailWebhookEvent(type: string, outcome: 'applied' | 'ignored'): void` on counter `mail_webhook_events_total{type, outcome}`. `type` is the event type when it is one of `email.bounced`, `email.complained`, else `other`.
- Behavior:
  - 404 while the secret is null; 401 on a bad signature; 400 on a body that is not JSON or has no `type` and `data.email_id` strings; else 200 `{ ok: true }`.
  - `email.bounced` with `data.bounce.type === 'Permanent'`: `markDelivery(id, 'bounced')`. If the row is kind `invoice`: `suppressions.add(row.to, 'invoice', 'bounce')`, outcome `applied`.
  - `email.complained`: `markDelivery(id, 'complained')`. If the row is kind `invoice`: `add(row.to, 'invoice', 'complaint')` and `outbox.cancelPendingInvoice(row.to)`, outcome `applied`.
  - Anything else, including no row and a non-invoice row: outcome `ignored`.
  - The handler logs nothing about the address or the body.

- [ ] **Step 1: Write the failing tests** in `resendWebhook.test.ts`, with the app from `test/testApp.ts` and the secret `whsec_` + base64 of 32 known bytes, signing in the test with node:crypto:
  - `the route answers 404 without a secret`.
  - `a bad signature, a missing header, and a timestamp 6 minutes old answer 401`.
  - `a header with two signatures passes when the second one matches`.
  - `a permanent bounce of an invoice e-mail blocks the address with reason bounce` (send an invoice e-mail first through the fake transport returning `'re_b1'`; post `email.bounced` with that id; `reasonOf` is `'bounce'`; the row `delivery` is `'bounced'`).
  - `a temporary bounce changes nothing`.
  - `a complaint blocks with reason complaint and cancels pending invoice e-mail to the address`.
  - `the same event twice answers 200 both times and leaves one active suppression row`.
  - `an unknown id and a login-code row answer 200 and add no suppression`.
  - `a signed body that is not JSON, or lacks data.email_id, answers 400`.
  - `the metric counts applied and ignored events` (render metrics, match `mail_webhook_events_total{type="email.bounced",outcome="applied"} 1`).
  - `config.test.ts`: `RESEND_WEBHOOK_SECRET without the whsec_ prefix is a problem`.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/mail/resendWebhook.test.ts src/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, wire `registerResendWebhook` in `app.ts` after `metrics` is created, and add `RESEND_WEBHOOK_SECRET=` with a one-line comment to `.env.example`. The test app must let a test set the secret and the transport id; extend `test/testApp.ts` options only if it cannot already.
- [ ] **Step 4: Run** the same command and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): Resend webhook for bounces and complaints`.

### Task 4: Sending to a blocked address, and the unblock

**Files:**
- Create: `apps/server/src/mail/resendSuppressions.ts`
- Modify: `apps/server/src/mail/InvoiceMailer.ts`, `apps/server/src/routes/invoiceLinks.ts`, `apps/server/src/routes/invoices.ts`, `apps/server/src/app.ts`
- Test: `apps/server/src/routes/invoiceEmail.test.ts`, `apps/server/src/mail/resendSuppressions.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `reasonOf`, `unblockedRecently`, `unblock`; Task 2 `recordBlocked`, `invoiceBounce`.
- Produces:
  - `export type Unsuppress = (address: string) => Promise<void>`
  - `export function resendUnsuppress(options: { apiKey: string; dispatcher?: Dispatcher }): Unsuppress`: `DELETE https://api.resend.com/suppressions/${encodeURIComponent(address)}` with the bearer key. 2xx and 404 resolve; any other status rejects.
  - `app.ts` passes `resendUnsuppress({ apiKey })` when `RESEND_API_KEY` is set, else a no-op. A new optional `deps.unsuppress?: Unsuppress` on the app lets tests inject one.
  - `InvoiceMailer` deps gain `unsuppress: Unsuppress`. `sendByHand(ctx, invoiceId, to, replyTo, options?: { confirmAddress?: boolean }): Promise<'sent' | 'suppressed' | 'unblocked' | false>`.
  - Order in `sendByHand`, after the caps: reason `bounce` and no `confirmAddress` → `HttpError(409, 'email_invalid_address')`. Reason `bounce` and `confirmAddress` → `unblockedRecently(to, 'invoice', now - 30 days)` ? `HttpError(409, 'email_invalid_address_final')` : `await unsuppress(to)` (a rejection → `HttpError(502, 'email_unblock_failed')`, the row stays), then `unblock(to, 'invoice', ctx)`, send, return `'unblocked'`. Reason `unsubscribe` or `complaint` → `'suppressed'` as today, whatever `confirmAddress` says.
  - `sendAutomatic`: when the reason is `bounce`, call `outbox.recordBlocked({ to, subject: '', ref })` and return false, before the claim. Other reasons return false as today.
  - Route body schema adds `confirmAddress: { type: 'boolean' }`. Audit detail: `manual unblocked @domain` for `'unblocked'`; a 409 or 502 writes no `ok` entry.
  - Invoice detail (`routes/invoices.ts`) adds `customerEmailProblem: { kind: 'invalid_address'; to: string } | null` from `outbox.invoiceBounce(ctx.accountId, invoice.id)`.

- [ ] **Step 1: Write the failing tests:**
  - `resendSuppressions.test.ts`: `DELETE goes to the encoded address with the key`; `404 resolves`; `500 rejects`.
  - `invoiceEmail.test.ts`:
    - `a send to a bounce-blocked address answers 409 email_invalid_address and queues nothing`.
    - `the same address in other case or with spaces is blocked too`.
    - `confirmAddress unblocks, calls unsuppress once with the address, sends, and audits manual unblocked @example.com`.
    - `a second confirmAddress within 30 days answers 409 email_invalid_address_final` (bounce, unblock, bounce again via the repository, confirm again).
    - `an unsuppress failure answers 502 email_unblock_failed and keeps the block`.
    - `confirmAddress does not lift an unsubscribe or a complaint: the answer is sent and nothing is queued`.
    - `a corrected address goes out normally while the old one stays blocked`.
    - `the automatic send to a bounce-blocked address records the block, and the detail shows customerEmailProblem with the address`.
    - `after a bounce webhook the detail shows customerEmailProblem; after a new successful send it is null`.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/routes/invoiceEmail.test.ts src/mail/resendSuppressions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `pnpm --filter @notaflow/server exec vitest run` and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): refuse a bounced address, and let the emitter unblock it`.

### Task 5: The screens

**Files:**
- Modify: `apps/web/src/api.ts` (`InvoiceDetail.customerEmailProblem`), `apps/web/src/pages/InvoiceDetailPage.tsx` (`emailStatus`), `apps/web/src/components/SendInvoiceEmail.tsx`, `apps/web/src/components/Layout.tsx` (`ERROR_TEXT`)
- Test: `apps/web/src/pages/InvoiceDetailPage.test.tsx`, `apps/web/src/components/SendInvoiceEmail.test.tsx` (create if absent, else extend)

**Interfaces:**
- Consumes: the API of Task 4.
- Produces:
  - `emailStatus` returns `E-mail não entregue: endereço inválido (${to})` when `customerEmailProblem` is set, before the "enviado" case. Shown with the warning look the page uses for problems.
  - `ERROR_TEXT` entries for `email_invalid_address`, `email_invalid_address_final`, `email_unblock_failed` with the copy in Global Constraints.
  - `SendInvoiceEmail`: on a 409 `email_invalid_address` for address X, it shows the error and a secondary button `O endereço está certo, enviar mesmo assim` that posts `{ to: X, confirmAddress: true }`. Any edit of the address field hides the button. The success view after an unblock is the same as a normal send.

- [ ] **Step 1: Write the failing tests:**
  - `InvoiceDetailPage.test.tsx`: `a bounced e-mail shows endereço inválido with the address` (detail with `customerEmailProblem: { kind: 'invalid_address', to: 'erro@exemplo.com' }` and a `customerEmailedAt` → text `E-mail não entregue: endereço inválido (erro@exemplo.com)`, and no `E-mail enviado`).
  - `SendInvoiceEmail.test.tsx`: `a 409 email_invalid_address offers the confirm button, which posts confirmAddress true`; `editing the address hides the confirm button`; `a 409 email_invalid_address_final shows its text and no confirm button`.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/web exec vitest run src/pages/InvoiceDetailPage.test.tsx src/components/SendInvoiceEmail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the error code the way other components read `ApiError` codes.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @notaflow/web exec vitest run`, `pnpm lint`, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show a bounced e-mail and let the emitter confirm the address`.

### Task 6: Policy, diagrams, and docs

**Files:**
- Modify: `apps/web/privacidade.html` (the table row at "lista de não envio" and the paragraph that starts "O NotaFlow também pode enviar ao tomador"), `apps/web/src/site/staticPages.test.ts`
- Modify: `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-1-context.mmd`, `c4-2-containers.mmd`, `c4-3-server-components.mmd` and their PNGs
- Modify: `apps/server/AGENTS.md` (Customer e-mail line), `docs/ENGINEERING/RFCS/2026/10/RFC_MAIL_BOUNCES.md` (Status: implemented)

**Content:**
- Policy table row becomes: `E-mail de quem pediu para não receber mais, de quem marcou o e-mail como spam, ou cujo endereço recusou o e-mail, com a data e o motivo (lista de não envio)`. The paragraph adds: `O Resend nos avisa quando um e-mail de nota volta porque o endereço não existe, ou quando o tomador o marca como spam; nos dois casos o endereço entra na lista de não envio. Se o endereço voltou, a empresa vê "endereço inválido" na nota e pode corrigi-lo ou confirmar que está certo.`
- No new `POLICY_NOTICE`: the change concerns the customers' data, not the users' (builder call, stated in the PR).
- Diagrams: context `resend -- "Reports bounces [HTTPS webhook]" --> notaflow`; containers the same arrow to `server`; components a new box `resendhook["<b>Resend webhook</b><br/><i>[Component: mail/resendWebhook]</i><br/>Marks bounces and complaints"]` with `resend --> resendhook` and `resendhook --> db`. Render the PNGs per `diagrams/README.md`.
- `apps/server/AGENTS.md`: one sentence: `Resend reports bounces and complaints to POST /webhooks/resend (src/mail/resendWebhook.ts, RESEND_WEBHOOK_SECRET); a bounce shows as customerEmailProblem and the emitter can unblock it once in 30 days.`

- [ ] **Step 1: Write the failing test** in `staticPages.test.ts`: `the privacy policy covers bounces and complaints` → the page text contains `marcou o e-mail como spam` and `endereço inválido`.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/web exec vitest run src/site/staticPages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Edit** the policy, the diagrams and PNGs, and the docs.
- [ ] **Step 4: Run** the same command and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: bounces in the privacy policy, C4 diagrams, and the server guide`.

## After the merge (operations, with the owner)

1. Resend: create the webhook to `https://notaflow.vapulab.com/webhooks/resend` with `email.bounced` and `email.complained`; copy the signing secret.
2. VPS: back up `.env` (`.env.bak-resendhook-<date>`), add `RESEND_WEBHOOK_SECRET`, recreate the server container.
3. Check: Resend's "send test" for the webhook answers 200; `mail_webhook_events_total` appears in metrics.
