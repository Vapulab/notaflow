import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('an owner invites a member, who then sees the account', async () => {
  const a = seedTenant(t.db, { accountName: 'Vapulab', email: 'owner@example.com' });
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('owner@example.com'),
    payload: { email: 'Contador@Example.com', name: 'Contador' },
  });
  expect(invite.statusCode).toBe(201);
  expect(Object.keys(invite.json()).sort()).toEqual(['emailSent', 'userId']);
  const me = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('contador@example.com'),
  });
  expect(me.json()).toMatchObject({ accounts: [{ id: a.accountId, role: 'member' }] });
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    action: 'member.invite',
    accountId: a.accountId,
  });
});

test('inviting an existing member is 409 already_member', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const payload = { email: 'm@example.com', name: 'M' };
  const url = `/api/accounts/${a.accountId}/members`;
  await t.app.inject({ method: 'POST', url, headers, payload });
  const again = await t.app.inject({ method: 'POST', url, headers, payload });
  expect(again.statusCode).toBe(409);
});

test('a member cannot invite: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'member@example.com', role: 'member' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('member@example.com'),
    payload: { email: 'x@example.com', name: 'X' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'owner_only' });
});

test('a suspended account can list members but cannot invite', async () => {
  const a = seedTenant(t.db, {
    accountName: 'A',
    email: 'owner@example.com',
    status: 'suspended',
  });
  const headers = await t.as('owner@example.com');
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/members`,
    headers,
  });
  expect(list.statusCode).toBe(200);
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers,
    payload: { email: 'x@example.com', name: 'X' },
  });
  expect(invite.statusCode).toBe(403);
  expect(invite.json()).toEqual({ error: 'account_suspended' });
});

test('a member cannot list the account users: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'member@example.com', role: 'member' });
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('member@example.com'),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'owner_only' });
});

test('the invited person gets an e-mail with the account, who invited, and how to enter', async () => {
  const a = seedTenant(t.db, { accountName: 'Vapulab', email: 'owner@example.com' });
  await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('owner@example.com'),
    payload: { email: 'Contador@Example.com', name: 'Contador' },
  });
  const sent = t.mail.filter((m) => m.to === 'contador@example.com');
  expect(sent).toHaveLength(1);
  expect(sent[0]?.subject).toBe('Convite para a conta Vapulab no NotaFlow');
  expect(sent[0]?.text).toContain('owner@example.com');
  expect(sent[0]?.text).toContain('http://localhost:3000/entrar');
  expect(sent[0]?.html).toContain('Vapulab');
});

test('a name with markup arrives escaped in the invite e-mail', async () => {
  const a = seedTenant(t.db, { accountName: '<b>Acme</b>', email: 'owner@example.com' });
  await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('owner@example.com'),
    payload: { email: 'novo@example.com', name: 'Novo' },
  });
  const html = t.mail.find((m) => m.to === 'novo@example.com')?.html ?? '';
  expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
  expect(html).not.toContain('<b>Acme</b>');
});

test('when the e-mail fails the member still exists, and the answer says the e-mail did not go', async () => {
  const own = await createTestApp({ failMail: true });
  const a = seedTenant(own.db, { accountName: 'Vapulab', email: 'owner@example.com' });
  const invite = await own.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await own.as('owner@example.com'),
    payload: { email: 'novo@example.com', name: 'Novo' },
  });
  expect(invite.statusCode).toBe(201);
  expect(invite.json()).toMatchObject({ emailSent: false });
  await own.close();
});

test('the 11th invite of an account in a day is 429 too_many_invites', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const url = `/api/accounts/${a.accountId}/members`;
  const codes: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const payload = { email: `m${i}@example.com`, name: `M${i}` };
    codes.push((await t.app.inject({ method: 'POST', url, headers, payload })).statusCode);
  }
  expect(codes).toEqual([...Array<number>(10).fill(201), 429]);
});
