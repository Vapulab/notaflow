import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, test } from 'vitest';

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

const BUSINESS = [
  'accounts',
  'users',
  'memberships',
  'emitters',
  'certificates',
  'customers',
  'services',
  'invoices',
  'invoice_events',
  'sync_state',
];
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
