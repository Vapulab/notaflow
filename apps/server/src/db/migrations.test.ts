import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterEach, expect, test } from 'vitest';
import { BUSINESS_TABLES, OTHER_TABLES } from './businessTables';
import * as schema from './schema';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The migrations folder cut at a journal index, to build a database as an older release left it.
function migrationsUpTo(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'notaflow-migrations-'));
  temps.push(dir);
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const T0 = 1_791_000_000_000;

// One row in each business table, written with the stage 2b schema (migrations 0000 to 0005).
function seedPre3a(client: BetterSqlite3.Database): void {
  const run = (sql: string) => client.prepare(sql).run();
  run(`INSERT INTO accounts (id, name, created_at) VALUES ('a1', 'Conta', ${T0})`);
  run(
    `INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'pessoa@example.com', 'Pessoa', ${T0})`,
  );
  run(
    `INSERT INTO memberships (id, user_id, account_id, role, created_at) VALUES ('m1', 'u1', 'a1', 'owner', ${T0})`,
  );
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, created_at)
       VALUES ('e1', 'a1', '12345678000195', 'EMPRESA', '4113700', '3', '0', '900', ${T0})`);
  run(`INSERT INTO certificates (id, emitter_id, pfx_ciphertext, password_ciphertext, wrapped_key, cnpj, subject, valid_from, valid_to,
       fingerprint_sha256, active, uploaded_by, created_at)
       VALUES ('c1', 'e1', x'00', x'00', x'00', '12345678000195', 'CN=X', ${T0}, ${T0}, 'f', 1, 'u1', ${T0})`);
  run(`INSERT INTO customers (id, emitter_id, document_type, document, name, origin, created_at, updated_at)
       VALUES ('k1', 'e1', 'CNPJ', '11222333000181', 'Cliente', 'imported', ${T0}, ${T0})`);
  run(`INSERT INTO services (id, emitter_id, name, national_tax_code, description, origin, created_at, updated_at)
       VALUES ('s1', 'e1', 'Serviço', '010101', 'Serviço', 'manual', ${T0}, ${T0})`);
  run(`INSERT INTO invoices (id, emitter_id, dps_series, dps_number, status, environment, competence, service_code, description,
       service_cents, net_cents, origin, created_at, updated_at)
       VALUES ('i1', 'e1', '900', 1, 'issued', 'producao', '2026-09-30', '010101', 'X', 100, 100, 'synced', ${T0}, ${T0})`);
  run(`INSERT INTO invoice_events (id, emitter_id, access_key, code, registered_at, xml_gzip, created_at)
       VALUES ('v1', 'e1', 'K', '101101', ${T0}, x'00', ${T0})`);
  run(
    `INSERT INTO sync_state (emitter_id, environment, last_run_at) VALUES ('e1', 'producao', ${T0})`,
  );
}

const BUSINESS = BUSINESS_TABLES;
const CONTROL = [
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
  'deleted_by',
];

function migratedFromPre3a(): BetterSqlite3.Database {
  const client = new BetterSqlite3(':memory:');
  client.pragma('foreign_keys = ON');
  const db = drizzle(client);
  migrate(db, { migrationsFolder: migrationsUpTo(5) });
  seedPre3a(client);
  migrate(db, { migrationsFolder: MIGRATIONS });
  // Business tables that came after stage 2b get their one row once they exist.
  client
    .prepare(
      `INSERT INTO account_documents (id, account_id, kind, cnpj, file_name, content_gzip, sha256, size_bytes, updated_at)
       VALUES ('d1', 'a1', 'cnpj_card', '12345678000195', 'cartao.pdf', x'00', 'h', 1, ${T0})`,
    )
    .run();
  client
    .prepare(
      `INSERT INTO bug_reports (id, account_id, title, description, page_path, updated_at)
       VALUES ('b1', 'a1', 'Erro', 'Descrição', '/app', ${T0})`,
    )
    .run();
  client
    .prepare(
      `INSERT INTO bug_report_images (id, bug_report_id, account_id, position, content_type, size_bytes, r2_key, updated_at)
       VALUES ('bi1', 'b1', 'a1', 1, 'image/webp', 10, 'bug-reports/b1/1.webp', ${T0})`,
    )
    .run();
  client
    .prepare(
      `INSERT INTO waitlist_signups (id, email, interests, source_page, updated_at)
       VALUES ('w1', 'w@example.com', '["mei"]', '/guia/mei', ${T0})`,
    )
    .run();
  client
    .prepare(
      `INSERT INTO invoice_links (id, invoice_id, token, updated_at)
       VALUES ('l1', 'i1', 'tok', ${T0})`,
    )
    .run();
  return client;
}

test('a stage 2b database migrates with every row kept and the control columns filled', () => {
  const client = migratedFromPre3a();
  for (const table of BUSINESS) {
    const columns = client
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => (c as { name: string }).name);
    expect(columns, table).toEqual(expect.arrayContaining(CONTROL));
    expect(client.prepare(`SELECT count(*) AS n FROM ${table}`).get(), table).toEqual({ n: 1 });
  }
  for (const table of ['accounts', 'users', 'memberships', 'emitters', 'invoice_events']) {
    expect(client.prepare(`SELECT updated_at FROM ${table}`).get(), table).toEqual({
      updated_at: T0,
    });
  }
  expect(
    client.prepare('SELECT created_at, created_by, updated_at FROM certificates').get(),
  ).toEqual({ created_at: T0, created_by: 'u1', updated_at: T0 });
  expect(client.prepare('SELECT created_at, updated_at FROM sync_state').get()).toEqual({
    created_at: T0,
    updated_at: T0,
  });
  client.close();
});

test('the unique indexes count only active rows', () => {
  const client = migratedFromPre3a();
  for (const name of [
    'users_email_active',
    'emitters_cnpj_active',
    'memberships_user_account',
    'customers_emitter_document',
    'services_emitter_import_key',
  ]) {
    const row = client
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name) as { sql: string } | undefined;
    expect(row?.sql, name).toMatch(/deleted_at.*IS NULL/i);
  }
  client.close();
});

test('no business row can be deleted, not even with raw SQL', () => {
  const client = migratedFromPre3a();
  for (const table of [...BUSINESS].reverse()) {
    expect(() => client.prepare(`DELETE FROM ${table}`).run(), table).toThrow(/soft delete only/);
  }
  client.close();
});

test('the audit log is append only', () => {
  const client = migratedFromPre3a();
  client
    .prepare(
      "INSERT INTO audit_log (user_email, action, entity, result) VALUES ('a@example.com', 'x', 'y', 'ok')",
    )
    .run();
  expect(() => client.prepare("UPDATE audit_log SET detail = 'x'").run()).toThrow(
    /audit log is append only/,
  );
  expect(() => client.prepare('DELETE FROM audit_log').run()).toThrow(/audit log is append only/);
  client.close();
});

test('every business table has its no-delete trigger, and every table is classified', () => {
  const client = migratedFromPre3a();
  const triggers = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all()
    .map((t) => (t as { name: string }).name);
  for (const table of BUSINESS) expect(triggers, table).toContain(`${table}_no_delete`);
  const tables = Object.values(schema as Record<string, unknown>)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => getTableConfig(table).name)
    .filter((name) => !(OTHER_TABLES as readonly string[]).includes(name));
  expect([...tables].sort()).toEqual([...BUSINESS].sort());
  client.close();
});

test('stage 3b: current users keep their row and count as verified; the auth tables accept deletes', () => {
  const client = new BetterSqlite3(':memory:');
  migrate(drizzle(client), { migrationsFolder: migrationsUpTo(8) });
  client
    .prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'pessoa@example.com', 'Pessoa')")
    .run();
  migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  expect(client.prepare('SELECT id, email_verified, image FROM users').all()).toEqual([
    { id: 'u1', email_verified: 1, image: null },
  ]);
  for (const table of ['auth_sessions', 'auth_accounts', 'auth_verifications', 'auth_passkeys']) {
    expect(() => client.prepare(`DELETE FROM ${table}`).run(), table).not.toThrow();
  }
  const trigger = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'users_no_delete'")
    .get();
  expect(trigger).toEqual({ name: 'users_no_delete' });
  client.close();
});

test('stage 3c: only an account with an active emitter skips onboarding', () => {
  const client = new BetterSqlite3(':memory:');
  migrate(drizzle(client), { migrationsFolder: migrationsUpTo(9) });
  const run = (sql: string) => client.prepare(sql).run();
  run("INSERT INTO accounts (id, name) VALUES ('with', 'A'), ('removed', 'B'), ('none', 'C')");
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series)
       VALUES ('e1', 'with', '12345678000195', 'EMPRESA', '4113700', '3', '0', '900')`);
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, deleted_at)
       VALUES ('e2', 'removed', '11222333000181', 'OUTRA', '4113700', '3', '0', '900', 1)`);
  migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  expect(client.prepare('SELECT id, onboarding_step FROM accounts ORDER BY id').all()).toEqual([
    { id: 'none', onboarding_step: 'card' },
    { id: 'removed', onboarding_step: 'card' },
    { id: 'with', onboarding_step: 'done' },
  ]);
  const triggers = client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('account_documents_no_delete', 'accounts_no_delete', 'users_no_delete') ORDER BY name",
    )
    .all();
  expect(triggers).toEqual([
    { name: 'account_documents_no_delete' },
    { name: 'accounts_no_delete' },
    { name: 'users_no_delete' },
  ]);
  client.close();
});

test('0016 backfills onboarding_done_at from the oldest emitter, and the new tables are append only', () => {
  const client = new BetterSqlite3(':memory:');
  migrate(drizzle(client), { migrationsFolder: migrationsUpTo(15) });
  const run = (sql: string) => client.prepare(sql).run();
  run(
    `INSERT INTO accounts (id, name, created_at, onboarding_step) VALUES ('a1', 'A', ${T0}, 'done')`,
  );
  run(
    `INSERT INTO accounts (id, name, created_at, onboarding_step) VALUES ('a2', 'B', ${T0}, 'card')`,
  );
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, created_at)
       VALUES ('e1', 'a1', '12345678000195', 'EMPRESA', '4113700', '3', '0', '900', ${T0 + 5000})`);
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, created_at)
       VALUES ('e2', 'a1', '11222333000181', 'OUTRA', '4113700', '3', '0', '900', ${T0 + 9000})`);
  run(
    `INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'pessoa@example.com', 'Pessoa', ${T0})`,
  );
  migrate(drizzle(client), { migrationsFolder: MIGRATIONS });

  expect(
    client.prepare('SELECT id, onboarding_done_at AS d FROM accounts ORDER BY id').all(),
  ).toEqual([
    { id: 'a1', d: T0 + 5000 },
    { id: 'a2', d: null },
  ]);
  const insert = (sentAt: number) =>
    run(`INSERT INTO lifecycle_emails (user_id, account_id, phase, step, variant, anchor_at, sent_at)
         VALUES ('u1', 'a1', 'activation', 1, 'card', ${T0}, ${sentAt})`);
  insert(T0);
  expect(() => insert(T0 + 1)).toThrow(/UNIQUE/);
  expect(() => run('DELETE FROM lifecycle_emails')).toThrow(/append only/);
  run(`INSERT INTO policy_notice_views (user_id, notice_id, seen_at) VALUES ('u1', 'n1', ${T0})`);
  expect(() => run('UPDATE policy_notice_views SET notice_id = 2')).toThrow(/append only/);
});

test('0022 marks every invoice with XML as pending and leaves the others without a PDF state', () => {
  const client = new BetterSqlite3(':memory:');
  migrate(drizzle(client), { migrationsFolder: migrationsUpTo(21) });
  const run = (sql: string) => client.prepare(sql).run();
  run(`INSERT INTO accounts (id, name, created_at) VALUES ('a1', 'A', ${T0})`);
  run(`INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, created_at)
       VALUES ('e1', 'a1', '12345678000195', 'EMPRESA', '4113700', '3', '0', '900', ${T0})`);
  const invoice = (id: string, n: number, xml: string) =>
    run(`INSERT INTO invoices (id, emitter_id, dps_series, dps_number, status, environment, competence, service_code, description,
         service_cents, net_cents, origin, xml_gzip, created_at, updated_at)
         VALUES ('${id}', 'e1', '900', ${n}, 'issued', 'producao', '2026-09-30', '010101', 'X', 100, 100, 'synced', ${xml}, ${T0}, ${T0})`);
  invoice('with', 1, "x'00'");
  invoice('without', 2, 'NULL');
  migrate(drizzle(client), { migrationsFolder: MIGRATIONS });

  expect(
    client.prepare('SELECT id, pdf_status AS s, pdf_mark AS m FROM invoices ORDER BY id').all(),
  ).toEqual([
    { id: 'with', s: 'pending', m: null },
    { id: 'without', s: null, m: null },
  ]);
  expect(
    client.prepare('SELECT id, pdf_pending_since AS p FROM invoices ORDER BY id').all(),
  ).toEqual([
    { id: 'with', p: expect.any(Number) },
    { id: 'without', p: null },
  ]);
  expect(() => run('DELETE FROM invoices')).toThrow();
});
