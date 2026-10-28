import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { GUIDE_PAGES } from '../../web/src/site/guide/pages';
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
  mkdirSync(join(root, 'guia'));
  for (const page of GUIDE_PAGES) {
    writeFileSync(join(root, page.file), `<!doctype html><main>guide ${page.path}</main>`);
  }
  writeFileSync(join(root, 'n.html'), '<!doctype html><main>link-page</main>');
  writeFileSync(join(root, '404.html'), '<!doctype html><main>nao-encontrada</main>');
  writeFileSync(join(root, 'llms.txt'), '# NotaFlow');
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

test.each(['/qualquer/coisa', '/robots', '/termos/x', '/apps'])(
  'an unknown page path %s answers 404 with the 404 page, never the app',
  async (url) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body).toContain('nao-encontrada');
  },
);

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
  // The app screens are empty to a crawler and need a login: keep them out of search results.
  expect(response.headers['x-robots-tag']).toBe('noindex');
});

test('serves the guide pages without authentication', async () => {
  const response = await app.inject({ url: '/guia/mei' });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('guide /guia/mei');
  expect((await app.inject({ url: '/guia' })).body).toContain('guide /guia');
  expect(response.headers['x-robots-tag']).toBeUndefined();
});

test('serves the DANFSe link page for any token, noindex and outside the sitemap', async () => {
  for (const url of [`/n/${'a'.repeat(43)}`, '/n/curto']) {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('link-page');
    expect(response.headers['x-robots-tag']).toBe('noindex');
  }
  expect((await app.inject({ url: '/sitemap.xml' })).body).not.toContain('/n/');
});

test('the public pages may be indexed', async () => {
  for (const url of ['/', '/termos', '/privacidade']) {
    expect((await app.inject({ url })).headers['x-robots-tag']).toBeUndefined();
  }
});

test('robots.txt allows the site, keeps crawlers out of the app and the API, and names the sitemap', async () => {
  const response = await app.inject({ url: '/robots.txt' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/plain');
  expect(response.body).toContain('User-agent: *\nAllow: /\n');
  for (const path of [
    '/app',
    '/admin',
    '/n/',
    '/api/',
    '/entrar',
    '/cadastro',
    '/recuperar-senha',
  ]) {
    expect(response.body).toContain(`Disallow: ${path}\n`);
  }
  expect(response.body).toContain('Sitemap: http://localhost:3000/sitemap.xml');
});

test('the sitemap lists the public pages at the app origin', async () => {
  const response = await app.inject({ url: '/sitemap.xml' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/xml');
  const locs = [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toEqual([
    'http://localhost:3000/',
    'http://localhost:3000/termos',
    'http://localhost:3000/privacidade',
    ...GUIDE_PAGES.map((page) => `http://localhost:3000${page.path}`),
  ]);
});

test('llms.txt is served as text', async () => {
  const response = await app.inject({ url: '/llms.txt' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/plain');
});

test('hashed assets are cached for a year; pages are revalidated', async () => {
  expect((await app.inject({ url: '/assets/app.js' })).headers['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
  expect((await app.inject({ url: '/' })).headers['cache-control']).toBe('no-cache');
  expect((await app.inject({ url: '/app' })).headers['cache-control']).toBe('no-cache');
});

test('an /api path never falls back to the app page', async () => {
  const response = await app.inject({ url: '/api/nothing' });
  expect(response.statusCode).toBe(401);
  expect(response.headers['content-type']).toContain('application/json');
});

test('a HEAD request gets the same status and headers as GET', async () => {
  const app200 = await app.inject({ method: 'HEAD', url: '/app' });
  expect(app200.statusCode).toBe(200);
  expect(app200.headers['x-robots-tag']).toBe('noindex');
  const missing = await app.inject({ method: 'HEAD', url: '/nao-existe' });
  expect(missing.statusCode).toBe(404);
  expect(missing.headers['content-type']).toContain('text/html');
});
