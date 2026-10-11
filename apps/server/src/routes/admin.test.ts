import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { users } from '../db/schema';
import { AuditLog } from '../repos/AuditLog';
import { IdentityRepository } from '../repos/IdentityRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  seedUser(t.db, 'admin@example.com', 'admin');
});
afterEach(() => t.close());

test('a platform admin creates an account and a user, and sets the owner', async () => {
  const headers = await t.as('admin@example.com');
  const account = await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts',
    headers,
    payload: { name: 'Vapulab' },
  });
  expect(account.statusCode).toBe(201);
  const { id: accountId } = account.json<{ id: string }>();

  const user = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers,
    payload: { email: 'Owner@Example.com', name: 'Owner' },
  });
  expect(user.statusCode).toBe(201);
  const { id: userId } = user.json<{ id: string }>();

  const member = await t.app.inject({
    method: 'PUT',
    url: `/api/admin/accounts/${accountId}/members/${userId}`,
    headers,
    payload: { role: 'owner' },
  });
  expect(member.statusCode).toBe(204);

  const me = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('owner@example.com'),
  });
  expect(me.json()).toMatchObject({ accounts: [{ id: accountId, role: 'owner' }] });

  const list = await t.app.inject({ method: 'GET', url: '/api/admin/accounts', headers });
  expect(list.json()).toEqual([
    expect.objectContaining({ id: accountId, name: 'Vapulab', members: 1 }),
  ]);
  expect(new AuditLog(t.db).list().map((e) => e.action)).toEqual([
    'account.create',
    'user.create',
    'membership.set',
  ]);
});

test('a user created with platformRole admin is a platform admin', async () => {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: await t.as('admin@example.com'),
    payload: { email: 'second@example.com', name: 'Second', platformRole: 'admin' },
  });
  expect(response.statusCode).toBe(201);
  expect(new IdentityRepository(t.db).findByEmail('second@example.com')?.platformRole).toBe(
    'admin',
  );
});

test('a second user with the same email is 409 user_exists', async () => {
  const headers = await t.as('admin@example.com');
  const payload = { email: 'x@example.com', name: 'X' };
  await t.app.inject({ method: 'POST', url: '/api/admin/users', headers, payload });
  const again = await t.app.inject({ method: 'POST', url: '/api/admin/users', headers, payload });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'user_exists' });
});

test('an admin suspends an account; an unknown account is 404', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = await t.as('admin@example.com');
  const status = await t.app.inject({
    method: 'POST',
    url: `/api/admin/accounts/${a.accountId}/status`,
    headers,
    payload: { status: 'suspended' },
  });
  expect(status.statusCode).toBe(204);
  const missing = await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts/missing/status',
    headers,
    payload: { status: 'suspended' },
  });
  expect(missing.statusCode).toBe(404);
});

test('a user who is not a platform admin gets 403 admin_only', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/admin/accounts',
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'admin_only' });
});

test('an invalid body is 400', async () => {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts/x/status',
    headers: await t.as('admin@example.com'),
    payload: { status: 'deleted' },
  });
  expect(response.statusCode).toBe(400);
});

test('the audit log is readable by a platform admin, newest first', async () => {
  const headers = await t.as('admin@example.com');
  await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts',
    headers,
    payload: { name: 'One' },
  });
  await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts',
    headers,
    payload: { name: 'Two' },
  });
  const response = await t.app.inject({ method: 'GET', url: '/api/admin/audit?limit=1', headers });
  expect(response.statusCode).toBe(200);
  const entries = response.json<{ action: string; entity: string }[]>();
  expect(entries).toHaveLength(1);
  const accounts = await t.app.inject({ method: 'GET', url: '/api/admin/accounts', headers });
  const two = accounts.json<{ id: string; name: string }[]>().find((x) => x.name === 'Two');
  expect(entries[0]).toMatchObject({ action: 'account.create', entity: two?.id });
});

test('a platform admin searches users by name or e-mail', async () => {
  seedUser(t.db, 'talita@example.com');
  seedUser(t.db, 'lincoln@example.com');
  const headers = await t.as('admin@example.com');
  const all = await t.app.inject({ method: 'GET', url: '/api/admin/users', headers });
  expect(all.statusCode).toBe(200);
  expect(
    all
      .json<{ email: string }[]>()
      .map((u) => u.email)
      .sort(),
  ).toEqual(['admin@example.com', 'lincoln@example.com', 'talita@example.com']);
  const found = await t.app.inject({ method: 'GET', url: '/api/admin/users?q=TALI', headers });
  expect(found.json()).toEqual([
    {
      id: expect.any(String),
      email: 'talita@example.com',
      name: 'talita',
      platformRole: 'user',
      lastLoginAt: null,
    },
  ]);
});

test('a user who is not a platform admin cannot list users', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(403);
});

test('an authenticated request records the last access, at most every 15 minutes', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const lastOf = () =>
    t.db
      .select({ at: users.lastLoginAt })
      .from(users)
      .where(eq(users.email, 'owner@example.com'))
      .get()?.at ?? null;
  expect(lastOf()).toBeNull();
  await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('owner@example.com') });
  const first = lastOf();
  expect(first).toBeInstanceOf(Date);

  const recent = new Date(Date.now() - 60_000);
  t.db.update(users).set({ lastLoginAt: recent }).where(eq(users.email, 'owner@example.com')).run();
  await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('owner@example.com') });
  expect(lastOf()?.getTime()).toBe(recent.getTime());

  const old = new Date(Date.now() - 60 * 60_000);
  t.db.update(users).set({ lastLoginAt: old }).where(eq(users.email, 'owner@example.com')).run();
  await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('owner@example.com') });
  expect(lastOf()?.getTime()).toBeGreaterThan(old.getTime());
});

test('the admin user list carries the last access', async () => {
  await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('admin@example.com') });
  const list = await t.app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: await t.as('admin@example.com'),
  });
  expect(list.json()).toEqual([
    expect.objectContaining({ email: 'admin@example.com', lastLoginAt: expect.any(String) }),
  ]);
});

test('a platform admin anonymizes a user: personal data goes, the row and the invoices stay', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  t.db.$client
    .prepare(
      `INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series)
       VALUES ('e1', ?, '12345678000195', 'EMPRESA', '4113700', '3', '0', '900')`,
    )
    .run(a.accountId);
  t.db.$client
    .prepare(
      `INSERT INTO invoices (id, emitter_id, dps_series, dps_number, status, environment, competence, service_code,
       description, service_cents, net_cents, origin, created_by)
       VALUES ('i1', 'e1', '900', 1, 'issued', 'producao', '2026-09-30', '010101', 'X', 100, 100, 'app', ?)`,
    )
    .run(a.userId);
  const headers = await t.as('admin@example.com');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/users/${a.userId}/anonymize`,
    headers,
    payload: {},
  });
  expect(response.statusCode).toBe(204);
  const user = t.db.$client
    .prepare('SELECT name, email, deleted_at, deleted_by FROM users WHERE id = ?')
    .get(a.userId) as Record<string, unknown>;
  expect(user).toMatchObject({
    name: 'Usuário removido',
    email: `removido-${a.userId}@anonimo.invalid`,
    deleted_at: expect.any(Number),
    deleted_by: expect.any(String),
  });
  const membership = t.db.$client
    .prepare('SELECT deleted_at FROM memberships WHERE user_id = ?')
    .get(a.userId) as { deleted_at: number | null };
  expect(membership.deleted_at).not.toBeNull();
  expect(t.db.$client.prepare('SELECT count(*) AS n FROM invoices').get()).toEqual({ n: 1 });
  const entry = new AuditLog(t.db).list().at(-1);
  expect(entry).toMatchObject({ action: 'user.anonymize', entity: a.userId, result: 'ok' });
  expect(JSON.stringify(entry)).not.toContain('pessoa@example.com');
  const again = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers,
    payload: { email: 'pessoa@example.com', name: 'Pessoa' },
  });
  expect(again.statusCode).toBe(201);
});

test('only a platform admin anonymizes, and an unknown user is not found', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'dono@example.com' });
  const asOwner = await t.app.inject({
    method: 'POST',
    url: `/api/admin/users/${a.userId}/anonymize`,
    headers: await t.as('dono@example.com'),
    payload: {},
  });
  expect(asOwner.statusCode).toBe(403);
  const unknown = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users/missing/anonymize',
    headers: await t.as('admin@example.com'),
    payload: {},
  });
  expect(unknown.statusCode).toBe(404);
});

test('a platform admin cannot anonymize themself', async () => {
  const self = new IdentityRepository(t.db).findByEmail('admin@example.com');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/users/${self?.userId ?? ''}/anonymize`,
    headers: await t.as('admin@example.com'),
    payload: {},
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'cannot_anonymize_self' });
});

test('anonymizing a user ends their sessions', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const userHeaders = await t.as('pessoa@example.com');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/users/${a.userId}/anonymize`,
    headers: await t.as('admin@example.com'),
    payload: {},
  });
  expect(response.statusCode).toBe(204);
  const left = t.db.$client
    .prepare('SELECT count(*) AS n FROM auth_sessions WHERE user_id = ?')
    .get(a.userId);
  expect(left).toEqual({ n: 0 });
  const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: userHeaders });
  expect(me.statusCode).toBe(401);
});

test('anonymizing removes the login credentials and the picture, which hold personal data', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const run = (sql: string, ...args: unknown[]) => t.db.$client.prepare(sql).run(...args);
  run("UPDATE users SET image = 'https://example.com/foto.png' WHERE id = ?", a.userId);
  run(
    `INSERT INTO auth_accounts (id, user_id, account_id, provider_id, id_token, created_at, updated_at)
     VALUES ('g1', ?, 'google-sub', 'google', 'header.payload.sig', 0, 0)`,
    a.userId,
  );
  run(
    `INSERT INTO auth_passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
     VALUES ('pk1', 'Notebook', 'key', ?, 'cred', 0, 'singleDevice', 0)`,
    a.userId,
  );
  run(
    `INSERT INTO auth_verifications (id, identifier, value, expires_at)
     VALUES ('v1', 'sign-in-otp-pessoa@example.com', 'hash', 0)`,
  );
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/users/${a.userId}/anonymize`,
    headers: await t.as('admin@example.com'),
    payload: {},
  });
  expect(response.statusCode).toBe(204);
  const count = (sql: string) => (t.db.$client.prepare(sql).get() as { n: number }).n;
  expect(count('SELECT count(*) AS n FROM auth_accounts')).toBe(0);
  expect(count('SELECT count(*) AS n FROM auth_passkeys')).toBe(0);
  expect(
    count(
      "SELECT count(*) AS n FROM auth_verifications WHERE identifier LIKE '%pessoa@example.com'",
    ),
  ).toBe(0);
  expect(t.db.$client.prepare('SELECT image FROM users WHERE id = ?').get(a.userId)).toEqual({
    image: null,
  });
});
