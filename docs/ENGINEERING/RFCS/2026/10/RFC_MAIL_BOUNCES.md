# RFC: Invoice E-mail Bounces and Complaints

Status: draft, 2026-10-29. Owner decisions: a bounce shows as "endereço inválido"; a corrected address goes out normally; the emitter can unblock an address; one Full access Resend key.

When an invoice e-mail to a customer bounces permanently, NotaFlow blocks the address and tells the emitter "endereço inválido". When the customer marks it as spam, NotaFlow blocks the address in silence, the same as an unsubscribe. Resend reports both events to a signed webhook. The emitter can correct the address and send again, or say that the address is correct and unblock it.

## Why

Each invoice e-mail goes to a third party that NotaFlow does not know. A typo in a customer e-mail makes every later invoice to that customer bounce again. Repeated bounces and spam complaints lower the reputation of `notas.notaflow.vapulab.com`, and then good e-mail goes to spam too. Today the emitter sees "E-mail enviado" for an e-mail that never arrived. This is protection before the problem: no bounce or complaint has occurred yet.

## Goals

1. A permanent bounce of an invoice e-mail blocks the address for invoice e-mail, and the invoice shows "E-mail não entregue: endereço inválido".
2. A spam complaint blocks the address for invoice e-mail, in silence, as an unsubscribe does today.
3. A send to an address that a bounce blocked tells the sender so, in every account, instead of a false "enviado".
4. The emitter can correct the address and send again. The new address goes out normally.
5. The emitter can say "o endereço está certo" and send again to a blocked address.

## Non-goals

- Bounces of login codes, invites, welcome, notices, and lifecycle e-mail. The webhook counts them in a metric and does nothing else.
- Temporary bounces and `email.delivery_delayed`. Resend retries them.
- Open and click tracking.
- An admin screen for the do-not-send list.

## Anti-goals

- An emitter must not learn that a customer unsubscribed or complained. Only a bounce is visible, because it says only that the address does not exist.
- The webhook must not accept an unsigned or stale request. A copy of a valid request inside the 5-minute window is accepted and changes nothing, because the handler is idempotent; no `svix-id` store (builder call).
- No log line keeps a full e-mail address or the webhook body (rule 10).

## Design

### Resend e-mail id

`resendMailer` reads the JSON answer of `POST /emails` and returns its `id`. The `Mailer` type becomes `(message) => Promise<string | null>`; `consoleMailer` returns `null`. `MailOutbox.attempt` stores the id in a new column `mail_outbox.provider_id` (indexed). The webhook finds the outbox row by this id.

### Webhook

`POST /webhooks/resend`, outside `/api`, like `/webhooks/github`: no login, no Origin check, raw body.

- Secret: `RESEND_WEBHOOK_SECRET` (`whsec_...`). While it is unset, the route answers 404.
- Verification (Svix scheme): the signed content is `${svix-id}.${svix-timestamp}.${rawBody}`. The key is the base64 part of the secret after `whsec_`. The algorithm is HMAC-SHA256, encoded in base64. `svix-signature` holds one or more space-separated `v1,<sig>` values. Any match passes, with a constant-time compare. A timestamp more than 5 minutes from the server clock fails. A failure answers 401.
- Events:
  - `email.bounced` with `data.bounce.type` `Permanent`: the row gets `delivery = 'bounced'`, and the address gets a suppression with reason `bounce`.
  - `email.complained`: the row gets `delivery = 'complained'`, and the address gets a suppression with reason `complaint`. Pending invoice rows to it are cancelled, as an unsubscribe does.
  - Any other event or bounce type: ignored.
- Only an outbox row of kind `invoice` changes. A row of another kind, or an unknown id, only counts in the metric.
- Every accepted request answers 200, also for an ignored event, so Resend does not retry it. The handler is idempotent: a second copy of the same event changes nothing.
- Metric: `mail_webhook_events_total{type, outcome}`.

### Schema

- `mail_outbox.provider_id` text, nullable, indexed.
- `mail_outbox.delivery` text enum `bounced | complained`, nullable.
- `mail_suppressions.reason` text enum `unsubscribe | bounce | complaint`, not null. The migration sets `unsubscribe` on the existing rows.

`mail_suppressions` stays one active row per address and kind. A complaint replaces a `bounce` reason on the active row, because a complaint must never be unblocked. An unsubscribe or a bounce does not replace an existing reason (builder call).

Resend keeps its own suppression list for the team: a hard bounce or a complaint adds the address there, and a later send to it comes back as `email.bounced` with `subType` `Suppressed`. The webhook treats that as a permanent bounce.

### What the emitter sees

The invoice API gets `customerEmailProblem: 'invalid_address' | null`. It is `invalid_address` when the latest invoice outbox row of the invoice has `delivery = 'bounced'`. A complaint never shows.

When the automatic send skips an invoice because a bounce blocked its address, it writes an outbox row of kind `invoice` with `status = 'cancelled'`, `delivery = 'bounced'`, and an empty body. So the invoice keeps the reason, and a later unblock does not change old invoices (builder call). A cancelled row does not count in the caps.

- Invoice page: "E-mail não entregue: endereço inválido (<address>)" in place of "E-mail enviado em ...".
- Send dialog, address blocked by a bounce: the server answers 409 `email_invalid_address`. The dialog shows "Este endereço já recusou um e-mail do NotaFlow. Confira se está certo." and a secondary button "O endereço está certo, enviar mesmo assim".
- That button sends again with `confirmAddress: true`. The server soft-deletes the bounce suppression and sends.
- A different address in the dialog goes out normally.
- Unsubscribe and complaint: no change. The send still answers as a success and sends nothing.

### Unblock guard

One unblock per address in 30 days, across all accounts, because the list is shared (builder call). The server checks it when `confirmAddress` arrives: a `bounce` suppression of the address soft-deleted in the last 30 days refuses it with 409 `email_invalid_address_final`, and the dialog says "Este endereço recusou o e-mail de novo. Use outro endereço." After 30 days the address can be unblocked again. A `complaint` row is never unblocked: the send answers as a success and sends nothing, as today. The audit log records the unblock with the domain only.

The unblock also removes the address from Resend's list with `DELETE https://api.resend.com/suppressions/{email}`, before the send. The call uses `RESEND_API_KEY`, which has Full access since 2026-10-29 (owner decision: one key, not a second one). A 404 from Resend counts as done. Any other failure answers 502 and keeps our row, so the emitter can try again.

### Privacy policy

The policy section about invoice e-mail adds that NotaFlow keeps an address that bounced or complained in the do-not-send list, and gets these events from Resend.

### Operations

1. In Resend, create a webhook to `https://notaflow.vapulab.com/webhooks/resend` with the events `email.bounced` and `email.complained`.
2. Put its signing secret in the VPS `.env` as `RESEND_WEBHOOK_SECRET`, back up `.env` first, and recreate the server container.
3. Check that the root `.env` has no other variable with this name ([Env name collisions] memory: checked 2026-10-29, none).

### Architecture

A new inbound arrow from Resend to the server. Update the C4 container `.mmd` and its PNG in the same PR.

## Left to the builder

- Exact copy of the Portuguese strings above can be tuned for length on a phone.
- Where `customerEmailProblem` is computed (repository join or a second query).
- Test scope: signature (valid, bad, old timestamp, multi-signature header), each event, idempotency, the 409 and the unblock guard, the UI states.
