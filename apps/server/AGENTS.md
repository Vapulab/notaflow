# Server: AI Context

The Fastify API: authentication, accounts and roles, the certificate vault, emitter onboarding, the audit log, the ADN sync, the read API, issue, reconcile, cancel, customers, and (Stage 2a) the fiscal configuration, services, and new invoices without a template.

## Quick Reference

- Entry: `src/main.ts` (`pnpm dev:server`); app wiring: `src/app.ts`; config: `src/config.ts`
- Database: `src/db/schema.ts`; migrations in `drizzle/` (`pnpm --filter @notaflow/server exec drizzle-kit generate --name <name>`)
- Onboarding: `src/routes/onboarding.ts`, `src/onboarding/` (card reader worker, CNPJ lookup), `src/emitters/EmitterOnboarding.ts`
- Login: Better Auth in `src/auth/betterAuth.ts`, mounted at `/api/auth/*` by `src/auth/authRoutes.ts`; `src/auth/authHook.ts` turns the session into an identity; e-mail in `src/mail/`
- Tests: `test/testApp.ts` builds the app on an in-memory database, logs in with `t.as(email)` (a real session cookie), collects sent e-mail in `t.mail`, and starts the fake national system
- Local run: copy `.env.example` to `.env.local`, then `pnpm fake:nacional`, `pnpm seed:admin <email> <name>`, and `pnpm dev:server`
- DANFSe download: `GET .../invoices/:invoiceId/danfse` in `src/routes/invoices.ts` streams the PDF from R2 (the object of the row's `pdf_mark`) when `pdfStatus` is `ready`, else draws it from the stored XML with `@notaflow/danfse-pdf` (counted by `danfse_on_demand_total`); it never calls the ADN
- DANFSe queue: `src/danfse/DanfseDispatcher.ts` sweeps `pending` rows every 10 s into the BullMQ queue `danfse` (`src/danfse/queue.ts`) and records the results. `REDIS_URL` is optional: unset, or set wrongly (the app logs the problem), the queue is off and downloads draw on demand, and the invoice API reports `pdfStatus: null`. The worker is `apps/danfse-worker`. Setup: [DANFSe Queue tutorial](../../docs/TUTORIALS/DANFSE_QUEUE.md)
- Public link: `src/routes/invoiceLinks.ts`. Members create and revoke it at `.../invoices/:invoiceId/link`; the public API is `GET /api/public/n/:token` and `/pdf` (60 per minute per IP, uniform 404, never log the token, always `cache-control: private, no-store`); `src/web.ts` serves `n.html` at `/n/:token`. Store: `src/repos/InvoiceLinkRepository.ts`
- Customer e-mail: `POST .../invoices/:invoiceId/email` and the automatic send after issue, both in `src/mail/InvoiceMailer.ts` through the mail outbox (`MailKind` `invoice`). Caps come from `mail_outbox` rows: 50 per hour per account, 5 per invoice per day. No automatic e-mail for produção restrita. The owner sets `autoEmailCustomer` per emitter. Every invoice e-mail has a signed unsubscribe link (`src/mail/invoiceUnsubscribe.ts`, table `mail_suppressions`); `MAIL_FROM_INVOICE` is its optional From Resend reports bounces and complaints to POST /webhooks/resend (src/mail/resendWebhook.ts, RESEND_WEBHOOK_SECRET); a bounce shows as customerEmailProblem and the emitter can unblock it once in 30 days.

## Documentation Index

- [Tenancy](../../docs/ENGINEERING/ARCHITECTURE/TENANCY.md) - accounts, roles, guards, and the route sweep
- [Onboarding](../../docs/ENGINEERING/ARCHITECTURE/ONBOARDING.md) - steps, the CNPJ card reader, the public lookup, and the ownership check
- [ADN Sync](../../docs/ENGINEERING/ARCHITECTURE/SYNC.md) - cursor, retries, and document rules
- [Invoice Lifecycle](../../docs/ENGINEERING/ARCHITECTURE/INVOICE_LIFECYCLE.md) - issue, E0014, reconcile, cancel, and the PTAX rule
- [New Invoice RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NEW_INVOICE.md) - fiscal configuration, services, customers by hand, `POST invoices/new`, and the tax reform
- [Certificate Vault](../../docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md) - envelope encryption and key rotation
- [RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and the security model
- [Logging](../../docs/ENGINEERING/CONVENTIONS/LOGGING.md) - the redaction rules for logs, audit details, and Sentry

## Key Rules

1. Every account query goes through a repository method that takes an `AccountContext`, built only by `accountContext()` in `src/auth/guards.ts`.
2. A new route with a new path parameter must be added to the route sweep (`src/routes/routeSweep.test.ts`).
3. Never log or return a certificate, a password, or the master key. Every log, audit detail, and Sentry report goes through `src/observability/redact.ts`; a route with a secret in its path adds a rule there. See [Logging](../../docs/ENGINEERING/CONVENTIONS/LOGGING.md).
4. A schema change needs a new migration in the same commit.
5. Never resend a DPS without a lookup by DPS id first, and never with a new number (`IssueService.reconcile`).
6. A new invoice without a template resends its stored `issue_template`; never rebuild it from the current customer or service records.
7. The national service code list is `src/data/serviceCodes.json`, converted from the official Anexo B; the loader names its source and date.
8. Never delete a business row (a trigger refuses it): writes spread `created`/`touched` from `src/db/stamps.ts`, reads use `notDeleted`, removal is `softDelete`. A migration that rebuilds a table recreates its `<table>_no_delete` trigger. See [Data](../../docs/ENGINEERING/CONVENTIONS/DATA.md).
9. Better Auth keeps its rate-limit counters per process: a test that calls `/api/auth/*` more than twice uses its own `remoteAddress`.
