import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

let root: string;
let app: ReturnType<typeof buildApp>;
let close: () => void;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'notaflow-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
  });
  const opened = openDatabase(':memory:');
  close = opened.close;
  app = buildApp({
    config,
    db: opened.db,
    webRoot: root,
    mailer: async () => {},
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  close();
  rmSync(root, { recursive: true, force: true });
});

test('serves index.html at the root and static assets', async () => {
  expect((await app.inject({ url: '/' })).body).toContain('id="root"');
  expect((await app.inject({ url: '/assets/app.js' })).body).toContain('console.log');
});

test('an unknown page path falls back to index.html without authentication', async () => {
  const response = await app.inject({ url: '/qualquer/coisa' });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('id="root"');
});

test('an unknown /api path still needs authentication, also when percent-encoded', async () => {
  expect((await app.inject({ url: '/api/nao-existe' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/%61pi/nao-existe' })).statusCode).toBe(401);
});
