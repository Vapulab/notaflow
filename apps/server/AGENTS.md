# Server: AI Context

The Fastify API: authentication, accounts and roles, the certificate vault, emitter onboarding, the audit log, the ADN sync, the read API, issue, reconcile, cancel, customers, and (Stage 2a) the fiscal configuration, services, and new invoices without a template.

## Quick Reference

- Entry: `src/main.ts` (`pnpm dev:server`); app wiring: `src/app.ts`; config: `src/config.ts`
- Database: `src/db/schema.ts`; migrations in `drizzle/` (`pnpm --filter @notaflow/server exec drizzle-kit generate --name <name>`)
- Onboarding: `src/routes/onboarding.ts`, `src/onboarding/` (card reader worker, CNPJ lookup), `src/emitters/EmitterOnboarding.ts`
- Login: Better Auth in `src/auth/betterAuth.ts`, mounted at `/api/auth/*` by `src/auth/authRoutes.ts`; `src/auth/authHook.ts` turns the session into an identity; e-mail in `src/mail/`
- Tests: `test/testApp.ts` builds the app on an in-memory database, logs in with `t.as(email)` (a real session cookie), collects sent e-mail in `t.mail`, and starts the fake national system
- Local run: copy `.env.example` to `.env.local`, then `pnpm fake:nacional`, `pnpm seed:admin <email> <name>`, and `pnpm dev:server`

- DANFSe download: `GET .../invoices/:invoiceId/danfse` in `src/routes/invoices.ts` draws the PDF from the stored XML with `@notaflow/danfse-pdf`; it never calls the ADN

## Documentation Index

- [Tenancy](../../docs/ENGINEERING/ARCHITECTURE/TENANCY.md) - accounts, roles, guards, and the route sweep
- [Onboarding](../../docs/ENGINEERING/ARCHITECTURE/ONBOARDING.md) - steps, the CNPJ card reader, the public lookup, and the ownership check
- [ADN Sync](../../docs/ENGINEERING/ARCHITECTURE/SYNC.md) - cursor, retries, and document rules
- [Invoice Lifecycle](../../docs/ENGINEERING/ARCHITECTURE/INVOICE_LIFECYCLE.md) - issue, E0014, reconcile, cancel, and the PTAX rule
- [New Invoice RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NEW_INVOICE.md) - fiscal configuration, services, customers by hand, `POST invoices/new`, and the tax reform
- [Certificate Vault](../../docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md) - envelope encryption and key rotation
- [RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and the security model

## Key Rules

1. Every account query goes through a repository method that takes an `AccountContext`, built only by `accountContext()` in `src/auth/guards.ts`.
2. A new route with a new path parameter must be added to the route sweep (`src/routes/routeSweep.test.ts`).
3. Never log or return a certificate, a password, or the master key.
4. A schema change needs a new migration in the same commit.
5. Never resend a DPS without a lookup by DPS id first, and never with a new number (`IssueService.reconcile`).
6. A new invoice without a template resends its stored `issue_template`; never rebuild it from the current customer or service records.
7. The national service code list is `src/data/serviceCodes.json`, converted from the official Anexo B; the loader names its source and date.
8. Never delete a business row (a trigger refuses it): writes spread `created`/`touched` from `src/db/stamps.ts`, reads use `notDeleted`, removal is `softDelete`. A migration that rebuilds a table recreates its `<table>_no_delete` trigger. See [Data](../../docs/ENGINEERING/CONVENTIONS/DATA.md).
9. Better Auth keeps its rate-limit counters per process: a test that calls `/api/auth/*` more than twice uses its own `remoteAddress`.
