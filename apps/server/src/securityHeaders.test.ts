import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

const THEME = "(function(){document.documentElement.dataset.theme='dark'})();";
const roots: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function appWith(origin: string, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notaflow-headers-'));
  roots.push(root);
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><script>${THEME}</script><div id="root"></div>`,
  );
  writeFileSync(
    join(root, 'landing.html'),
    `<!doctype html><script>${THEME}</script><main></main>`,
  );
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: origin,
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
    ...env,
  });
  const opened = openDatabase(':memory:');
  const app = buildApp({ config, db: opened.db, webRoot: root, mailer: async () => {} });
  closers.push(async () => {
    await app.close();
    opened.close();
  });
  return app;
}

test('every response says nosniff, no framing, a strict referrer, and no camera or microphone', async () => {
  const app = await appWith('http://localhost:3000');
  for (const url of ['/app', '/api/health']) {
    const headers = (await app.inject({ url })).headers;
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  }
});

test('HSTS only when the app is served over HTTPS', async () => {
  expect(
    (await (await appWith('http://localhost:3000')).inject({ url: '/app' })).headers[
      'strict-transport-security'
    ],
  ).toBeUndefined();
  const secure = await appWith('https://notaflow.vapulab.com');
  expect((await secure.inject({ url: '/app' })).headers['strict-transport-security']).toBe(
    'max-age=31536000',
  );
});

test('a page allows only its own scripts, its inline theme script by hash, Turnstile, and PostHog', async () => {
  const app = await appWith('http://localhost:3000', { POSTHOG_TOKEN: 'phc_x' });
  const csp = String((await app.inject({ url: '/app' })).headers['content-security-policy']);
  const hash = createHash('sha256').update(THEME).digest('base64');
  expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
  expect(csp).toContain('https://challenges.cloudflare.com');
  expect(csp).toContain('https://us.i.posthog.com');
  expect(csp).toContain('https://us-assets.i.posthog.com');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});

test('an API answer allows nothing to load', async () => {
  const app = await appWith('http://localhost:3000');
  expect((await app.inject({ url: '/api/health' })).headers['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
});

test('a revisit of a page answers 304 with the page policy, which the browser keeps', async () => {
  const app = await appWith('http://localhost:3000');
  const first = await app.inject({ url: '/' });
  expect(first.headers['content-security-policy']).toContain("script-src 'self'");
  const revisit = await app.inject({
    url: '/',
    headers: { 'if-none-match': String(first.headers.etag) },
  });
  expect(revisit.statusCode).toBe(304);
  expect(revisit.headers['content-security-policy']).toContain("script-src 'self'");
});
