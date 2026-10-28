import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { backupDatabase } from './backup';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notaflow-backup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('the backup is a readable copy, taken while another connection writes', async () => {
  const source = join(dir, 'notaflow.db');
  const db = new Database(source);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (n INTEGER)');
  db.prepare('INSERT INTO t VALUES (1)').run();
  const writing = setInterval(() => db.prepare('INSERT INTO t VALUES (2)').run(), 1);
  const path = await backupDatabase(source, join(dir, 'backups'), new Date('2026-10-09T06:00:00Z'));
  clearInterval(writing);
  db.close();
  expect(path).toMatch(/notaflow-20261009-060000\.db$/);
  const copy = new Database(path, { readonly: true });
  expect(copy.prepare('SELECT count(*) AS c FROM t WHERE n = 1').get()).toEqual({ c: 1 });
  copy.close();
});

test('only the newest backups are kept', async () => {
  const source = join(dir, 'notaflow.db');
  new Database(source).close();
  const backups = join(dir, 'backups');
  for (const hour of ['01', '02', '03']) {
    await backupDatabase(source, backups, new Date(`2026-10-09T${hour}:00:00Z`), 2);
  }
  expect(readdirSync(backups).sort()).toEqual(['notaflow-20261009-020000.db', 'notaflow-20261009-030000.db']);
});
