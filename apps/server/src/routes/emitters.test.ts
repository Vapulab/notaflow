import { makeTestCertificate } from '@notaflow/test-kit';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { accounts, users } from '../db/schema';
import { AuditLog } from '../repos/AuditLog';
import { CertificateRepository } from '../repos/CertificateRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const testCert = makeTestCertificate({ cnpj: '12345678000195' });
const body = (overrides: Record<string, unknown> = {}) => ({
  pfxBase64: testCert.pfx.toString('base64'),
  password: testCert.password,
  municipality: '3550308',
  simplesNacional: '1',
  specialRegime: '0',
  dpsSeries: '900',
  ...overrides,
});

async function onboard(accountId: string, email: string, payload = body()) {
  return t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/emitters`,
    headers: await t.as(email),
    payload,
  });
}

async function listEmitters(accountId: string, email: string) {
  return t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/emitters`,
    headers: await t.as(email),
  });
}

test('an owner onboards an emitter: connection test, sealed certificate, production', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(a.accountId, 'owner@example.com');
  expect(response.statusCode).toBe(201);
  const created = response.json<{ id: string; environment: string; cnpj: string }>();
  expect(created).toMatchObject({
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    environment: 'producao',
  });

  const stored = new CertificateRepository(t.db).activeFor(a, created.id);
  expect(stored?.pfxCiphertext.includes(testCert.pfx.subarray(0, 64))).toBe(false);
  expect(new AuditLog(t.db).list().map((e) => [e.action, e.result])).toEqual([
    ['emitter.create', 'ok'],
    ['certificate.upload', 'ok'],
  ]);

  const list = await listEmitters(a.accountId, 'owner@example.com');
  expect(list.json()).toEqual([
    expect.objectContaining({
      id: created.id,
      cnpj: '12345678000195',
      environment: 'producao',
      certificate: { validTo: expect.any(String), expiresSoon: false },
    }),
  ]);
});

test('a wrong password is 400 WRONG_PASSWORD and the response does not echo it', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(
    a.accountId,
    'owner@example.com',
    body({ password: 'senha-errada-123' }),
  );
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'WRONG_PASSWORD' });
  expect(response.body).not.toContain('senha-errada-123');
});

test('a CNPJ of another account is 409, nothing is stored, and the refusal is audited', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  expect((await onboard(a.accountId, 'a@example.com')).statusCode).toBe(201);
  const response = await onboard(b.accountId, 'b@example.com');
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: 'cnpj_in_other_account' });
  expect((await listEmitters(b.accountId, 'b@example.com')).json()).toEqual([]);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    accountId: b.accountId,
    result: 'refused',
  });
});

test('the same CNPJ twice in one account is 409 emitter_exists', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  await onboard(a.accountId, 'a@example.com');
  const again = await onboard(a.accountId, 'a@example.com');
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'emitter_exists' });
});

test('a failed connection test is 502 and stores nothing', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  t.fake.next('convenio', { kind: 'reply', status: 503, body: 'down' });
  const response = await onboard(a.accountId, 'a@example.com');
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'connection_test_failed' });
  expect((await listEmitters(a.accountId, 'a@example.com')).json()).toEqual([]);
  expect((await onboard(a.accountId, 'a@example.com')).statusCode).toBe(201);
});

test('a certificate that expires in less than 30 days is flagged', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const soon = makeTestCertificate({
    cnpj: 'AB345678000195',
    notAfter: new Date(Date.now() + 10 * 86_400_000),
  });
  await onboard(
    a.accountId,
    'a@example.com',
    body({ pfxBase64: soon.pfx.toString('base64'), password: soon.password }),
  );
  expect((await listEmitters(a.accountId, 'a@example.com')).json()).toEqual([
    expect.objectContaining({ certificate: expect.objectContaining({ expiresSoon: true }) }),
  ]);
});

test('a double submit answers 201 once and 409 emitter_exists, never 500', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const statuses = (
    await Promise.all([
      onboard(a.accountId, 'a@example.com'),
      onboard(a.accountId, 'a@example.com'),
    ])
  ).map((r) => r.statusCode);
  expect(statuses.sort()).toEqual([201, 409]);
});

test('two accounts racing for one CNPJ: 201 and 409 cnpj_in_other_account, audited', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const responses = await Promise.all([
    onboard(a.accountId, 'a@example.com'),
    onboard(b.accountId, 'b@example.com'),
  ]);
  const loser = responses.find((r) => r.statusCode !== 201);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(loser?.json()).toEqual({ error: 'cnpj_in_other_account' });
  expect(new AuditLog(t.db).list().some((e) => e.result === 'refused')).toBe(true);
});

test('a member cannot onboard: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'm@example.com', role: 'member' });
  expect((await onboard(a.accountId, 'm@example.com')).statusCode).toBe(403);
});

async function onboarded(email = 'owner@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  const response = await onboard(a.accountId, email);
  return { a, emitterId: response.json<{ id: string }>().id };
}

test('the owner replaces the certificate with one of the same CNPJ', async () => {
  const { a, emitterId } = await onboarded();
  const next = makeTestCertificate({ cnpj: '12345678000195' });
  const before = new CertificateRepository(t.db).activeFor(a, emitterId)?.id;
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/certificate`,
    headers: await t.as('owner@example.com'),
    payload: { pfxBase64: next.pfx.toString('base64'), password: next.password },
  });
  expect(response.statusCode).toBe(204);
  expect(new CertificateRepository(t.db).activeFor(a, emitterId)?.id).not.toBe(before);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ action: 'certificate.upload' });
});

test('a certificate of another CNPJ is 400 cnpj_mismatch', async () => {
  const { a, emitterId } = await onboarded();
  const other = makeTestCertificate({ cnpj: '98765432000110' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/certificate`,
    headers: await t.as('owner@example.com'),
    payload: { pfxBase64: other.pfx.toString('base64'), password: other.password },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'cnpj_mismatch' });
});

test('only a platform admin switches the environment; an owner gets 403 admin_only', async () => {
  const { a, emitterId } = await onboarded();
  const url = `/api/accounts/${a.accountId}/emitters/${emitterId}/environment`;
  const response = await t.app.inject({
    method: 'POST',
    url,
    headers: await t.as('owner@example.com'),
    payload: { environment: 'producao_restrita' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'admin_only' });
  expect((await listEmitters(a.accountId, 'owner@example.com')).json()).toEqual([
    expect.objectContaining({ environment: 'producao' }),
  ]);
});

test('a platform admin switches to produção restrita and back with the literal confirmation, audited', async () => {
  const { a, emitterId } = await onboarded('admin@example.com');
  t.db
    .update(users)
    .set({ platformRole: 'admin' })
    .where(eq(users.email, 'admin@example.com'))
    .run();
  const url = `/api/accounts/${a.accountId}/emitters/${emitterId}/environment`;
  const headers = await t.as('admin@example.com');
  const toTest = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { environment: 'producao_restrita' },
  });
  expect(toTest.statusCode).toBe(204);
  const missing = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { environment: 'producao', confirm: 'yes' },
  });
  expect(missing.statusCode).toBe(400);
  expect(missing.json()).toEqual({ error: 'confirmation_required' });
  const back = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { environment: 'producao', confirm: 'producao' },
  });
  expect(back.statusCode).toBe(204);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    action: 'emitter.environment',
    detail: 'producao',
  });
});

test('a suspended account cannot switch the environment', async () => {
  const { a, emitterId } = await onboarded();
  t.db.update(accounts).set({ status: 'suspended' }).where(eq(accounts.id, a.accountId)).run();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/environment`,
    headers: await t.as('owner@example.com'),
    payload: { environment: 'producao', confirm: 'producao' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'account_suspended' });
});

test('an emitter of another account is 404 on the environment route, also for a platform admin', async () => {
  const { emitterId } = await onboarded();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  t.db.update(users).set({ platformRole: 'admin' }).where(eq(users.email, 'b@example.com')).run();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${b.accountId}/emitters/${emitterId}/environment`,
    headers: await t.as('b@example.com'),
    payload: { environment: 'producao', confirm: 'producao' },
  });
  expect(response.statusCode).toBe(404);
});

test('an emitter municipality outside the IBGE table is refused', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(
    a.accountId,
    'owner@example.com',
    body({ municipality: '9999999' }),
  );
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'unknown_municipality' });
});

test('a CNPJ of a removed emitter is refused until a platform admin restores it', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const first = await onboard(a.accountId, 'owner@example.com');
  expect(first.statusCode).toBe(201);
  t.db.$client
    .prepare('UPDATE emitters SET deleted_at = 1 WHERE id = ?')
    .run(first.json<{ id: string }>().id);
  const again = await onboard(a.accountId, 'owner@example.com');
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ error: 'emitter_removed' });
  const b = seedTenant(t.db, { accountName: 'B', email: 'other@example.com' });
  const elsewhere = await onboard(b.accountId, 'other@example.com');
  expect(elsewhere.statusCode).toBe(409);
  expect(elsewhere.json()).toMatchObject({ error: 'emitter_removed' });
});
