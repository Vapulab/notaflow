# Data Conventions

NotaFlow never deletes a business row, and every row says who created, changed, and removed it, and when. The database enforces the first rule; the repositories follow the second through one helper module.

## Business tables

`accounts`, `users`, `memberships`, `emitters`, `certificates`, `customers`, `services`, `invoices`, `invoice_events`, `sync_state`, `account_documents` (the CNPJ cards of onboarding, gzipped), and `bug_reports`. The list lives in `apps/server/src/db/businessTables.ts`. A new table goes there, or it is `audit_log`; a test fails otherwise.

## Control columns

Every business table has `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, and `deleted_by`.

- Timestamps are integers in milliseconds.
- `*_by` holds a user id, with no foreign key. Null means the system: the sync, the scheduler, or the seed script.

Repositories set them through `apps/server/src/db/stamps.ts`:

| Helper | Use |
| --- | --- |
| `created(actor)` | Spread into every `insert(...).values(...)`. |
| `touched(actor)` | Spread into every `update(...).set(...)`. |
| `removed(actor)` | What `softDelete` writes. |
| `notDeleted(table)` | In the `where` of every read, once per business table in the query (joins included). |
| `softDelete(db, table, id, actor)` | The only way to remove a business row. |

`actor` is the `AccountContext` or the `AdminContext` of the request, or null for the system. The scheduler's context says `userId: 'system'`, and `actorId` stores it as null.

## No delete

- A `<table>_no_delete` trigger on every business table aborts any `DELETE` with `soft delete only`, also from a script or a shell on the server.
- The audit log has `audit_log_no_update` and `audit_log_no_delete`: it is append only.
- **A migration that rebuilds a table drops its triggers.** drizzle-kit rebuilds SQLite tables for some changes. Recreate the trigger in the same migration. `apps/server/src/db/migrations.test.ts` fails while a business table lacks its trigger.

## Unique indexes

- A unique index on a business table counts only active rows: ``uniqueIndex(...).on(...).where(sql`deleted_at IS NULL`)``. A removed e-mail or customer document can come back.
- **A CNPJ of a removed emitter cannot come back** (409 `emitter_removed`), in any account, until a platform admin restores the emitter.
  - Its invoices stay under the removed emitter: the access key is globally unique, so a new emitter could never sync them.
  - Its sync would also update the hidden rows of the old one.
- An upsert on such an index passes ``targetWhere: sql`deleted_at IS NULL` ``.
- Drizzle 0.45 writes the `WHERE` of `onConflictDoNothing` in the wrong place, so a "do nothing" insert uses no target.
- `invoices.access_key` stays globally unique: an NFS-e key never repeats. The sync finds a removed invoice by its key and keeps it removed.

## Archive or remove

- **Archive** (`archived`, on customers and services) is a choice the user makes and reverts in the app. Archived rows stay in reads that ask for them.
- **Remove** (`deleted_at`) hides the row from every read; only a platform admin reverts it.

## Audit log

Every entry has the user's e-mail, the account, the action, the entity, the result, and a detail. A request also fills `ip`, `user_agent`, and `request_id` from `apps/server/src/requestContext.ts`.

Behind the Cloudflare tunnel, the IP is `cf-connecting-ip`. The header is trusted only when the socket comes from a private range, which is the Docker network of the tunnel.

## Personal data erasure (LGPD)

`POST /api/admin/users/:userId/anonymize` (platform admin):

- replaces the name and the e-mail with anonymous values;
- soft-deletes the user and the user's memberships;
- audits the action without the old e-mail.

Invoices and their XML stay as tax records. Account documents (the CNPJ cards) are account data, not the person's: they stay with the account. An admin cannot anonymize themself (409 `cannot_anonymize_self`). The anonymization and its audit entry are one transaction.

**What erasure keeps.** The audit log keeps the e-mail and the IP of the entries the user made before the erasure; the trigger makes them permanent. The basis:
- Marco Civil da Internet (Lei 12.965/2014), art. 15: an application provider keeps its access records (IP, date and time) for at least 6 months.
- LGPD, art. 7, II and IX, and art. 16, I: compliance with a legal obligation, and the legitimate interest in security and fraud prevention.

This is a decision to confirm in the legal review of stage 3d. If the review asks for a time limit, past entries need a migration that recreates the audit triggers around a scrub.

## Exceptions

The four Better Auth tables are credentials, not business rows, and are listed in `OTHER_TABLES`. Better Auth deletes their rows itself:

- `auth_sessions`: on sign-out, expiry, "sair de todos os dispositivos", and the anonymization of a user;
- `auth_verifications`: when a code is used or expires;
- `auth_accounts` (a password or a linked Google): when the user unlinks Google;
- `auth_passkeys`: when the user removes a passkey.

The audit log records each of these events.
