# Invoice Lifecycle

The server issues a new NFS-e by copying a stored one ("issue similar"), protects every issue against duplicates with a pending row and a lookup by DPS id, and cancels an issued invoice. The screens come in Stage 1b-2; this page describes the API and its rules.

## Status

```
pending ──► issued ──► cancelled
   │
   ├──► rejected
   └──► unknown ──► issued | rejected   (after reconciliation)
```

A synced invoice starts as `issued` or `cancelled`. Only an invoice issued by the app passes through `pending`, `rejected`, or `unknown`.

## Issue

`POST /api/accounts/:accountId/invoices/issue` with the template invoice, the competence, the amounts, and optionally a new description and a stored customer.

1. **Template.** The stored XML of an `issued` or `cancelled` invoice is read by `readTemplate`. Every fiscal group is copied as it is: ISS taxation, PIS/COFINS, Simples, `IBSCBS`, `comExt`. A field that the DPS builder cannot write is refused with 422 `template_unsupported` and the field paths. The template never loses a field in silence.
2. **Checks, before anything is reserved.** The service amount is above zero (the Sefin accepts zero, so the app refuses it). An export template needs the amount in the foreign currency. The competence is not after today in Brasília. The emitter has an active certificate. A chosen customer has a document.
3. **Reserve.** In one transaction: the next DPS number of the emitter, a `pending` row with the DPS id, and an audit entry. The number is never one that the emitter already used in its series, also for invoices issued before the app.
4. **Send.** The DPS is built from the template, signed (Node signer, `rsa-sha256-exc-c14n`), and sent. The issue date is now minus 60 seconds, because the Sefin refuses a future date.
5. **Outcome.**
   - Issued: the row gets the access key, the number, and the XML; the customer register is updated.
   - Rejected: the row keeps the Sefin codes and messages. This is a normal answer (201 with `status: 'rejected'`), because the row exists.
   - Uncertain (timeout, 5xx, network): the row becomes `unknown`.

## New invoice without a template

`POST /api/accounts/:accountId/invoices/new` with the emitter, a stored customer, a stored service, the competence, the amount, and for a customer abroad the BACEN currency code and the foreign amount. Optional overrides: `simplesPercent`, `issRate`, `issRetained`, `description`. The design is in the [New Invoice RFC](../RFCS/2026/10/RFC_NEW_INVOICE.md).

1. **Checks, before anything is reserved.** The emitter has a fiscal configuration (409 `fiscal_config_missing`). The service and the customer belong to the emitter (404 `service_not_found`, `customer_not_found`). A Brazil customer has a Brazilian address (`customer_address_incomplete`); a customer abroad has a foreign address (`customer_country_missing`) and a foreign amount (`invalid_amount`); a Brazil customer has none (`foreign_amount_not_allowed`). The emitter is an ME/EPP Simples optant (`emitter_not_simples`). Retention is refused for a customer abroad or a CPF (`retention_not_allowed`) and needs a rate above zero (`invalid_iss_rate`). The competence is a calendar date (`invalid_competence`) not after the issue date in Brasília, which is now minus 60 seconds. The description is not blank (`invalid_description`). Customer text is checked against the XSD when the customer is saved (`invalid_text`). The amount and the certificate are checked as above.
2. **Build.** `buildTemplate` writes the fiscal groups from the emitter, the service, and the customer, with the rules of the competence (`taxRules`). For a Brazil customer the ISS is taxable in the municipality; `pAliq` is written only when the ISS is retained (the Sefin refuses it otherwise for an ME/EPP, E0625). For a customer abroad the invoice is an export with `comExt`. A 2027 competence is refused until the IBS/CBS stage.
3. **Reserve.** As above. The pending row stores the built template (`issue_template`, JSON); `template_of` stays empty.
4. **Send and outcome.** As above, with the same idempotency and E0014 behavior. An error before the DPS leaves the server (a template, XML, or signature error) is a certain refusal: the row becomes `rejected` with `local_error`, not `unknown`. When the Sefin issued but the local save fails, the answer is `unknown` and reconcile or the sync records the invoice.
5. **Stored template.** `issue_template` carries a version. Reconcile first checks that it rebuilds the stored DPS id; otherwise it answers 422 `template_unreadable` and sends nothing.

## Idempotency

The issue form sends an `Idempotency-Key` header, one per review, and keeps it after an unclear answer (see [Web UI](WEB_UI.md)). The key is stored on the pending row, unique per emitter. A repeat with the same key answers `200` with the first row's current state and reserves nothing, also when two requests arrive at the same time. Without the header, every call is a new issue.

## E0014

E0014 means "an NFS-e already exists for this DPS". The issuer then looks the invoice up by DPS id and returns it. The service accepts it only when its competence, amount, description, and customer document match the pending row (`isOwnInvoice`). Otherwise another system used that DPS number, and the row becomes `rejected` with E0014, so the user issues again with the next number.

## Reconcile

`POST /api/accounts/:accountId/invoices/:invoiceId/reconcile`, for a `pending` or `unknown` row, always in the row's own environment (the emitter may have switched since):

1. `GET /dps/{id}` at the Sefin. Found: the row becomes `issued`, after the same check as above.
2. Not found: the app resends the **same** DPS number with a fresh issue date. The pending row keeps everything the resend needs, including the foreign amount. A new invoice resends its stored `issue_template` as it was sent; it is never rebuilt from the customer or service records, which may have changed since.
3. Still uncertain: the row stays `unknown`.

The app never resends blindly. The ADN sync can also complete an `unknown` row: an invoice with the same emitter and DPS id takes over that row instead of adding a second one, after the same `isOwnInvoice` check. When the check fails, the row becomes `rejected` with E0014 and the synced invoice gets its own row.

## Cancel

`POST /api/accounts/:accountId/invoices/:invoiceId/cancel` with the reason (1, 2, or 9) and a justification of 15 to 255 characters after trimming. The event goes to the Sefin in the invoice's own environment. A registered event is stored and the invoice becomes `cancelled`, also when the event XML is unreadable. A Sefin refusal is 422 `sefin_rejected` with its code and message; the invoice stays `issued`.

A cancel that the Sefin refuses because the invoice is already cancelled (codes in `ALREADY_CANCELLED_CODES`) marks the row `cancelled` and answers `alreadyCancelled: true`. That happens when the first cancel reached the Sefin but its answer did not reach the app.

## Export amount (PTAX)

For an export invoice, the BRL amount is the foreign amount at the PTAX **sell** rate of the **closing bulletin** ("Fechamento PTAX") of the Banco Central on the competence date. Without a closing bulletin on that date (a weekend or a holiday), the rate of the last business day before it is used, and the answer names that date. The server enforces it on both issue paths: it fetches the rate of the competence date and refuses another BRL amount with 400 `amount_ptax_mismatch` (with `expectedCents`, `rate`, and `rateDate`). Without a rate nothing is issued (502 `ptax_unavailable`). The audit entry of the pending row names the rate and its date. The form shows the BRL amount read-only and reviews only with the rate loaded.

Decision (2026-10-10, Lincoln): the BRL amount is always the PTAX of the competence date. Two early export invoices of the first emitter used a bank contract rate; NotaFlow no longer issues that way.

`GET /api/accounts/:accountId/exchange-rate?currency=220&date=YYYY-MM-DD` returns the rate. Rates are integers scaled by 10 000 (`54321` for 5.4321), so no float touches money.

## Customers

`PUT /api/accounts/:accountId/customers/:customerId` edits name, email, phone, municipal registration, and address. Every field sent becomes a manual field, which the sync never overwrites.

Code: `apps/server/src/issue/`, `packages/provider-nacional/src/template/`, `packages/provider-nacional/src/NacionalIssuer.ts`.
