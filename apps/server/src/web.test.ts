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
let config: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'notaflow-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'landing.html'), '<!doctype html><main>landing</main>');
  writeFileSync(join(root, 'termos.html'), '<!doctype html><main>termos</main>');
  writeFileSync(join(root, 'privacidade.html'), '<!doctype html><main>privacidade</main>');
  config = loadConfig({
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

test('serves the landing at the root and static assets', async () => {
  expect((await app.inject({ url: '/' })).body).toContain('landing');
  expect((await app.inject({ url: '/?utm_source=x' })).body).toContain('landing');
  expect((await app.inject({ url: '/assets/app.js' })).body).toContain('console.log');
});

test.each([
  ['/termos', 'termos'],
  ['/privacidade', 'privacidade'],
])('serves the legal page %s without authentication', async (url, text) => {
  const response = await app.inject({ url });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/html');
  expect(response.body).toContain(text);
});

test('without a built landing the root serves the app', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'notaflow-web-bare-'));
  writeFileSync(join(bare, 'index.html'), '<!doctype html><div id="root"></div>');
  const opened = openDatabase(':memory:');
  const other = buildApp({ config, db: opened.db, webRoot: bare, mailer: async () => {} });
  expect((await other.inject({ url: '/' })).body).toContain('id="root"');
  await other.close();
  opened.close();
  rmSync(bare, { recursive: true, force: true });
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

test.each([
  '/app',
  '/app/x/notas',
  '/app/x/notas/nova?cliente=c',
  '/entrar',
  '/cadastro',
  '/recuperar-senha',
  '/admin',
])('a reload on %s serves the app', async (url) => {
  const response = await app.inject({ url });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/html');
  expect(response.body).toContain('id="root"');
});

test('an /api path never falls back to the app page', async () => {
  const response = await app.inject({ url: '/api/nothing' });
  expect(response.statusCode).toBe(401);
  expect(response.headers['content-type']).toContain('application/json');
});
