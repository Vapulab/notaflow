import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
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
  expect(all.json<{ email: string }[]>().map((u) => u.email).sort()).toEqual([
    'admin@example.com',
    'lincoln@example.com',
    'talita@example.com',
  ]);
  const found = await t.app.inject({ method: 'GET', url: '/api/admin/users?q=TALI', headers });
  expect(found.json()).toEqual([
    { id: expect.any(String), email: 'talita@example.com', name: 'talita', platformRole: 'user' },
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
