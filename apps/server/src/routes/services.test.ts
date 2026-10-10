import type { AccountRole } from '@notaflow/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

function withEmitter(options: { role?: AccountRole } = {}) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com', ...options });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const base = `/api/accounts/${a.accountId}`;
  return { a, base, list: `${base}/emitters/${emitter.id}/services` };
}

const service = {
  name: 'Desenvolvimento',
  nationalTaxCode: '010101',
  nbsCode: '115080000',
  description: 'Desenvolvimento de software',
  pisCofinsCst: '00',
};

test('the owner creates, edits, and archives a service; the list hides archived ones', async () => {
  const { list, base } = withEmitter();
  const headers = await t.as('a@example.com');
  const created = await t.app.inject({ method: 'POST', url: list, headers, payload: service });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({ ...service, origin: 'manual', archived: false });
  const id = (created.json() as { id: string }).id;

  const edited = await t.app.inject({
    method: 'PUT',
    url: `${base}/services/${id}`,
    headers,
    payload: { ...service, name: 'Software' },
  });
  expect(edited.json()).toMatchObject({ name: 'Software' });

  const archived = await t.app.inject({
    method: 'PUT',
    url: `${base}/services/${id}`,
    headers,
    payload: { ...service, archived: true },
  });
  expect(archived.json()).toMatchObject({ archived: true });
  expect((await t.app.inject({ method: 'GET', url: list, headers })).json()).toEqual([]);
  const all = await t.app.inject({ method: 'GET', url: `${list}?archived=1`, headers });
  expect(all.json()).toHaveLength(1);
  expect(new AuditLog(t.db).list().map((e) => e.action)).toEqual([
    'service.create',
    'service.edit',
    'service.edit',
  ]);
});

test('a code that is not in the national list is refused', async () => {
  const { list } = withEmitter();
  const response = await t.app.inject({
    method: 'POST',
    url: list,
    headers: await t.as('a@example.com'),
    payload: { ...service, nationalTaxCode: '999999' },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'unknown_service_code' });
});

test('a member reads services but cannot create one', async () => {
  const { list } = withEmitter({ role: 'member' });
  const headers = await t.as('a@example.com');
  expect((await t.app.inject({ method: 'GET', url: list, headers })).statusCode).toBe(200);
  const write = await t.app.inject({ method: 'POST', url: list, headers, payload: service });
  expect(write.statusCode).toBe(403);
});

test('an unknown service is not found', async () => {
  const { base } = withEmitter();
  const response = await t.app.inject({
    method: 'PUT',
    url: `${base}/services/missing`,
    headers: await t.as('a@example.com'),
    payload: service,
  });
  expect(response.statusCode).toBe(404);
});

test('the service code search answers members with at most 20 codes', async () => {
  const { base } = withEmitter({ role: 'member' });
  const response = await t.app.inject({
    method: 'GET',
    url: `${base}/service-codes?q=informatica`,
    headers: await t.as('a@example.com'),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual([
    { code: '010601', description: 'Assessoria e consultoria em informática.' },
    expect.objectContaining({ code: '010701' }),
  ]);
});
