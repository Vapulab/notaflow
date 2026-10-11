import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';
import { softDelete } from '../db/stamps';
import { users } from '../db/schema';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('GET /api/me without a session is 401', async () => {
  const response = await t.app.inject({ method: 'GET', url: '/api/me' });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: 'unauthenticated' });
});

test('a forged session cookie is 401', async () => {
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: 'notaflow.session_token=forged.value' },
  });
  expect(response.statusCode).toBe(401);
});

test('a session from another app instance (another secret store) is 401', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const other = await createTestApp();
  seedTenant(other.db, { accountName: 'A', email: 'a@example.com' });
  const cookie = await other.cookieFor('a@example.com');
  await other.close();
  const response = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  expect(response.statusCode).toBe(401);
});

test('GET /api/me returns the user and accounts of the session', async () => {
  const a = seedTenant(t.db, { accountName: 'Vapulab', email: 'lincoln@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('lincoln@example.com'),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    userId: a.userId,
    email: 'lincoln@example.com',
    name: 'lincoln',
    platformRole: 'user',
    tourSeenAt: null,
    accounts: [
      {
        id: a.accountId,
        name: 'Vapulab',
        role: 'owner',
        status: 'active',
        onboardingStep: 'card',
        needsFiscalConfig: false,
      },
    ],
  });
});

test('the session of a removed user is 401', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = await t.as('a@example.com');
  softDelete(t.db, users, a.userId, null);
  const response = await t.app.inject({ method: 'GET', url: '/api/me', headers });
  expect(response.statusCode).toBe(401);
});

test('a mutation without the app Origin is 403 bad_origin', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = { ...(await t.as('a@example.com')), origin: 'https://evil.example.com' };
  const response = await t.app.inject({ method: 'POST', url: '/api/me', headers, payload: {} });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'bad_origin' });
});

test('a mutation that is not JSON is 415 json_required', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = { ...(await t.as('a@example.com')), 'content-type': 'text/plain' };
  const response = await t.app.inject({ method: 'POST', url: '/api/me', headers, payload: 'x' });
  expect(response.statusCode).toBe(415);
  expect(response.json()).toEqual({ error: 'json_required' });
});

test('Better Auth refuses its own routes from another origin', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = { ...(await t.as('a@example.com')), origin: 'https://evil.example.com' };
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers,
    payload: {},
  });
  expect(response.statusCode).toBe(403);
  expect(t.db.$client.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toEqual({ n: 1 });
});

test('sign-out ends the session', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = await t.as('a@example.com');
  const out = await t.app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers: { ...headers, origin: ORIGIN },
    payload: {},
  });
  expect(out.statusCode).toBe(200);
  const response = await t.app.inject({ method: 'GET', url: '/api/me', headers });
  expect(response.statusCode).toBe(401);
});

test('a session in use renews: after a day, the cookie and the expiry move forward', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = await t.as('a@example.com');
  const day = 24 * 60 * 60 * 1000;
  const old = Date.now() + 29 * day - 60_000;
  t.db.$client.prepare('UPDATE auth_sessions SET expires_at = ?').run(old);
  const response = await t.app.inject({ method: 'GET', url: '/api/me', headers });
  expect(response.statusCode).toBe(200);
  expect([response.headers['set-cookie']].flat().join(';')).toContain('notaflow.session_token=');
  const row = t.db.$client.prepare('SELECT expires_at FROM auth_sessions').get() as {
    expires_at: number;
  };
  expect(row.expires_at).toBeGreaterThan(old + day / 2);
});

test('the tour is marked as seen once, and /api/me tells which accounts lack a fiscal configuration', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  t.db.$client
    .prepare(
      `INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series)
       VALUES ('e1', ?, '12345678000195', 'EMPRESA', '4113700', '3', '0', '900')`,
    )
    .run(a.accountId);
  const headers = await t.as('a@example.com');
  const before = await t.app.inject({ method: 'GET', url: '/api/me', headers });
  expect(before.json()).toMatchObject({
    tourSeenAt: null,
    accounts: [{ id: a.accountId, needsFiscalConfig: true }],
  });
  const seen = await t.app.inject({
    method: 'POST',
    url: '/api/me/tour-seen',
    headers,
    payload: {},
  });
  expect(seen.statusCode).toBe(204);
  t.db.$client.prepare("UPDATE emitters SET simples_annex = 'III', simples_percent = 600").run();
  const after = await t.app.inject({ method: 'GET', url: '/api/me', headers });
  expect(after.json()).toMatchObject({
    tourSeenAt: expect.any(String),
    accounts: [{ needsFiscalConfig: false }],
  });
});
