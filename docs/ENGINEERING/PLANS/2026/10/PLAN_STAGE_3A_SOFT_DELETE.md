# Stage 3a: Soft Delete and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No business row is ever deleted, every row says who created, changed, and removed it and when, and the audit log is append only with the request's IP, browser, and id.

**Architecture:**

- Two migrations do the database work. The first adds the control columns and replaces unique constraints with partial unique indexes, which ignore removed rows. The second adds triggers that refuse `DELETE` on business tables and refuse `UPDATE` or `DELETE` on the audit log.
- Repositories stamp `*_at` and `*_by` through one helper module, and they read through one `notDeleted` filter.
- An `AsyncLocalStorage` request context feeds the audit log, so no audit call site changes.

**Tech Stack:** SQLite (better-sqlite3), Drizzle ORM 0.45 and drizzle-kit 0.31, Fastify 5, Vitest.

**Spec:** [RFC_SAAS_SIGNUP](../../RFCS/2026/10/RFC_SAAS_SIGNUP.md), section "Stage 3a: Soft Delete and Audit".

## Global Constraints

- **Business tables:** `accounts`, `users`, `memberships`, `emitters`, `certificates`, `customers`, `services`, `invoices`, `invoice_events`, `sync_state`.
- **Control columns on each business table:**
  - `created_at`, `updated_at`, and `deleted_at`, as `integer` timestamps in ms;
  - `created_by`, `updated_by`, and `deleted_by`, as `text` user ids with no foreign key.
  - Null in a `*_by` column means the system.
- **The scheduler's actor** is the string `system` (`apps/server/src/sync/scheduler.ts`). It is stored as null.
- **SQLite forbids `ADD COLUMN` with a non-constant default.** New timestamp columns are added nullable, backfilled in the same migration, and set by the app.
- **A unique index that skips removed rows** is `uniqueIndex(...).on(...).where(sql\`deleted_at IS NULL\`)`. Every upsert on it passes the same `targetWhere`.
- **`invoices.access_key` stays globally unique.** An NFS-e key never repeats.
- **No `DELETE` statement** in app code. The test-only helper that resets a database must not exist either; tests open a new in-memory database.
- **Project rules:** no TypeScript non-null assertions; no AI attribution in commits; English text follows the Writing Style, with no em dash.

## Review Focus

1. **A later migration that recreates a table drops its triggers.** drizzle-kit rebuilds SQLite tables for some changes. Expected: a test fails when any business table lacks its no-delete trigger after all migrations. Pinned in Task 2.
2. **An upsert on a partial unique index.** Expected: the membership upsert, the service import, and the customer import keep working with the `deleted_at IS NULL` target. Pinned in Task 4.
3. **A removed row reappearing.** Expected: every repository read ignores a row with `deleted_at` set, including lookups by unique key (e-mail, CNPJ, document), joins, and counts. Pinned in Task 4.
4. **The sync writing as `system`.** Expected: rows written by the scheduler carry null in `created_by` and `updated_by`, never the text `system`. Pinned in Task 3.
5. **An existing production database.** Expected: migrating a copy of a pre-3a database keeps every row, and `updated_at` equals `created_at` on rows that had no `updated_at`. Pinned in Task 1.

---

### Task 1: Control columns and partial unique indexes

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0006_*.sql` (generated, then edited to append the backfill) and its snapshot
- Test: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces, in `schema.ts`, a column helper used by every business table:

```ts
// Who and when for every business row; null *_by means the system.
const control = () => ({
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedBy: text('deleted_by'),
});
```

- Tables that already have a column of the same name keep it, with its current type and default, and get only the missing ones. Specifically:
  - `invoices.created_by` and `invoice_events.created_by` keep their foreign key to users.
  - `certificates` keeps `uploaded_at` and `uploaded_by`, and gains all six columns, backfilled from them.
  - `audit_log` keeps only `at` (it is the audit itself).

- [ ] **Step 1: Failing migration test.** `migrations.test.ts` builds a pre-3a database:
  1. Run the migrator with the folder copied to a temp directory, limited to `0000` to `0005` (the journal entries up to idx 5).
  2. Insert one row in each business table with raw SQL.
  3. Run the full migrator.

  It asserts:
  - every row is still there;
  - each new column exists (`PRAGMA table_info`);
  - `updated_at` equals `created_at` where `updated_at` was missing;
  - `certificates.created_by` equals `uploaded_by`.

  It also asserts the partial indexes by catalog: `SELECT sql FROM sqlite_master WHERE type='index' AND name=?` contains `deleted_at IS NULL` for `users_email_active`, `emitters_cnpj_active`, `memberships_user_account`, `customers_emitter_document`, and `services_emitter_import_key`.
- [ ] **Step 2:** Run `pnpm vitest run apps/server/src/db/migrations.test.ts` → FAIL (no columns, no partial indexes).
- [ ] **Step 3: Implement.**
  1. Add `control()` to the business tables.
  2. Replace `email: text('email').notNull().unique()` and `cnpj: ... .unique()` with partial unique indexes named `users_email_active` and `emitters_cnpj_active`.
  3. Make the existing `memberships`, `customers`, and `services` unique indexes partial.
  4. Run `pnpm --filter @notaflow/server exec drizzle-kit generate --name soft_delete_columns`.
  5. Read the SQL. It must add nullable columns, and it rebuilds `users` and `emitters` to drop their column constraints.
  6. Append the backfill statements, each followed by `--> statement-breakpoint`:
     - `UPDATE <t> SET updated_at = created_at WHERE updated_at IS NULL;` for every business table with `created_at`;
     - `UPDATE certificates SET created_at = uploaded_at, created_by = uploaded_by, updated_at = uploaded_at;`;
     - `UPDATE sync_state SET created_at = coalesce(last_run_at, unixepoch() * 1000), updated_at = coalesce(last_run_at, unixepoch() * 1000);`.
- [ ] **Step 4:** Run the migration test, the server suite, typecheck, and lint → PASS. Commit `feat(server): control columns and partial unique indexes`.

### Task 2: Triggers: no delete, append-only audit

**Files:**
- Create: `apps/server/drizzle/0007_no_delete_triggers.sql` (`drizzle-kit generate --custom --name no_delete_triggers`)
- Test: `apps/server/src/db/migrations.test.ts`

- [ ] **Step 1: Failing tests.**
  - On a migrated in-memory database, for each business table, inserting a row and running `DELETE FROM <t>` throws `soft delete only`.
  - On the audit log, `UPDATE audit_log SET detail = 'x'` and `DELETE FROM audit_log` throw `audit log is append only`.
  - **Catalog guard (Review Focus 1):** for every business table, `sqlite_master` has a trigger named `<table>_no_delete`. The test reads the business table list from one exported constant, `BUSINESS_TABLES` in `apps/server/src/db/businessTables.ts`. It also asserts that every `sqliteTable` in `schema.ts` other than `audit_log` is in that list, so a new table cannot skip the rule.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** One statement per table:

```sql
CREATE TRIGGER `accounts_no_delete` BEFORE DELETE ON `accounts`
BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;--> statement-breakpoint
```

  Then `audit_log_no_update` and `audit_log_no_delete` with `RAISE(ABORT, 'audit log is append only')`.

  Add a short note at the top of `schema.ts`. A migration that rebuilds a table must recreate its trigger, and the catalog test fails until it does.
- [ ] **Step 4:** Server suite, typecheck, lint → PASS. Commit `feat(server): the database refuses deletes and audit changes`.

### Task 3: Stamps: who and when on every write

**Files:**
- Create: `apps/server/src/db/stamps.ts`, `apps/server/src/db/stamps.test.ts`
- Modify: every repository with an insert or update (Admin, Certificate, Customer, Emitter, Identity, Invoice, Member, Service, SyncState, AuditLog stays as is)
- Test: `apps/server/src/repos/stamps.repos.test.ts`

**Interfaces:**

```ts
import type { AccountContext, AdminContext } from '@notaflow/core';

export type Actor = AccountContext | AdminContext | null; // null: the system
// The scheduler's context says 'system'; the database stores null.
export function actorId(actor: Actor): string | null;
export function created(actor: Actor): { createdAt: Date; updatedAt: Date; createdBy: string | null; updatedBy: string | null };
export function touched(actor: Actor): { updatedAt: Date; updatedBy: string | null };
export function removed(actor: Actor): { deletedAt: Date; deletedBy: string | null; updatedAt: Date; updatedBy: string | null };
```

- [ ] **Step 1: Failing tests.**
  - `stamps.test.ts`:
    - `actorId({ ...ctx, userId: 'system' })` is null and `actorId(null)` is null;
    - `created(ctx)` sets both `*_by` to `ctx.userId`, with equal timestamps.
  - `stamps.repos.test.ts`, one test per repository write:
    - creating a customer by hand, an emitter, and a service stores `created_by = ctx.userId`;
    - `setManual`, `setFiscalConfig`, `setArchived`, and `markIssued` set `updated_by` and move `updated_at`;
    - a sync write (`upsertSynced` and `importService` with a `userId: 'system'` context) stores null `created_by` (Review Focus 4).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - Every `.insert(...).values({...})` spreads `...created(ctx)`, and every `.update(...).set({...})` spreads `...touched(ctx)`.
  - The existing `updatedAt: new Date()` and `createdBy: ctx.userId` lines are replaced by the helpers.
  - The admin repository passes its `AdminContext`, and the seed script passes null.
- [ ] **Step 4:** Server suite, typecheck, lint → PASS. Commit `feat(server): every write records who and when`.

### Task 4: Reads ignore removed rows

**Files:**
- Modify: `apps/server/src/db/stamps.ts` (add `notDeleted`, `softDelete`), every repository read and the three upserts, `apps/server/src/seed.ts`
- Test: `apps/server/src/repos/softDelete.repos.test.ts`

**Interfaces:**

```ts
// The one filter every repository read uses; it takes the table, so joins filter each side.
export function notDeleted(table: { deletedAt: AnySQLiteColumn }): SQL;
// The only way to remove a business row.
export function softDelete<T extends SQLiteTable & { deletedAt: AnySQLiteColumn; id: AnySQLiteColumn }>(
  db: Database, table: T, id: string, actor: Actor,
): boolean;
```

- [ ] **Step 1: Failing tests** in `softDelete.repos.test.ts`. One test per repository. Each creates two rows, soft-deletes one with `softDelete`, and checks that every read of that repository ignores it:
  - `get`, `list`, the `findBy*` lookups, `isCnpjTakenElsewhere`, `findByIdempotencyKey`, `issueState`, `xml`;
  - the identity membership list;
  - the admin `listAccounts` member count and `listUsers`;
  - the sync target list.

  **Re-creation after removal:** a removed user's e-mail can be created again (`AdminRepository.createUser`), and a removed membership can be set again (`setMembership`, the upsert with `targetWhere`).

  **Upserts (Review Focus 2):** `importService` and `upsertImported` still dedupe against an active row and create a new one when only a removed row matches.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - Add `notDeleted(table)` to the `where` of every read; in joins, for each joined business table.
  - Pass `targetWhere: sql\`deleted_at IS NULL\`` (or `where` for `onConflictDoNothing`) on the three upserts.
  - Remove the duplicate-check queries that relied on the old global unique constraints, if any.
- [ ] **Step 4:** Server suite, typecheck, lint → PASS. Commit `feat(server): removed rows are invisible to every read`.

### Task 5: Audit with IP, browser, and request id

**Files:**
- Create: `apps/server/src/requestContext.ts` (an `AsyncLocalStorage<{ ip: string; userAgent: string; requestId: string }>`)
- Modify: `apps/server/src/app.ts` (an `onRequest` hook that enters the context), `apps/server/src/repos/AuditLog.ts` (reads the context), `apps/server/src/db/schema.ts` and a generated migration `0008_audit_request` (three nullable columns)
- Test: `apps/server/src/routes/auditContext.test.ts`

- [ ] **Step 1: Failing test.** A customer edit through `t.app.inject` with `remoteAddress: '203.0.113.7'` and a `user-agent` header writes an audit entry with that `ip`, `user_agent`, and the Fastify `request.id`. An entry written outside a request (the scheduler) has null in all three.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Behind the Cloudflare tunnel the client IP is `cf-connecting-ip`; read it only when the request came through the tunnel network (`request.ip` in the private range of the Docker network), otherwise use `request.ip`. **Step 4:** PASS. Commit `feat(server): the audit log records the request's IP, browser, and id`.

### Task 6: Personal data erasure (LGPD)

**Files:**
- Modify: `apps/server/src/repos/AdminRepository.ts` (`anonymizeUser`), `apps/server/src/routes/admin.ts` (`POST /api/admin/users/:userId/anonymize`)
- Test: `apps/server/src/routes/admin.test.ts`

- [ ] **Step 1: Failing tests.**
  - A platform admin anonymizes a user:
    - name becomes `Usuário removido`;
    - email becomes `removido-<id>@anonimo.invalid`;
    - `deleted_at` and `deleted_by` are set;
    - the user's memberships are soft-deleted.
  - The response is 204, and the audit entry `user.anonymize` names the user id without the old e-mail.
  - The user's invoices are untouched.
  - The old e-mail can sign up again.
  - A non-admin gets 403.
- [ ] **Step 2:** FAIL. **Step 3:** Implement in one transaction with `removed(adminCtx)`. **Step 4:** PASS. Commit `feat(server): anonymize a user on an erasure request`.

### Task 7: Docs and the production check

- [ ] **Docs.**
  - Add `docs/ENGINEERING/CONVENTIONS/DATA.md`: control columns, `stamps.ts`, `notDeleted`, `softDelete`, triggers, partial indexes, and the migration rule (a rebuilt table recreates its trigger).
  - Add rule 9 to `AGENTS.md`: "Never delete a business row: use `softDelete`; every read uses `notDeleted`."
  - Add the rule to `apps/server/AGENTS.md`.
  - Update the RFC status.
- [ ] **Migration on a copy of production.**
  1. Copy the latest backup from the VPS (`/data/backups/notaflow-*.db`) to the scratchpad.
  2. Run the migrator on the copy locally.
  3. Check that the row counts of every table are the same before and after, and that a `DELETE` is refused.
  4. Print counts only, never data.
  5. Delete the copy afterwards.
- [ ] Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pytest services/signer-py` → PASS. Build the image from `git archive HEAD`; the server starts and `/api/health` is ok.
- [ ] Commit `docs: soft delete and audit conventions`.
