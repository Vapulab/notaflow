import type { AccountContext, AccountRole } from '@notaflow/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const imported = {
  document: { type: 'CNPJ' as const, value: '98765432000110' },
  name: 'Cliente Exemplo Ltda',
  email: 'financeiro@example.com',
};

function withCustomer(options: { role?: AccountRole; status?: 'active' | 'suspended' } = {}) {
  const a: AccountContext = seedTenant(t.db, { accountName: 'A', email: 'a@example.com', ...options });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const customerId = new CustomerRepository(t.db).upsertImported(a, emitter.id, imported) ?? '';
  return { a, emitterId: emitter.id, customerId, url: `/api/accounts/${a.accountId}/customers/${customerId}` };
}

test('GET returns the customer without its manual field list', async () => {
  const { url } = withCustomer();
  const response = await t.app.inject({ method: 'GET', url, headers: await t.as('a@example.com') });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ name: 'Cliente Exemplo Ltda', document: '98765432000110' });
  expect(response.json()).not.toHaveProperty('manualFields');
});

test('an edit sticks, is audited, and survives a re-sync of the same customer', async () => {
  const { a, emitterId, url } = withCustomer();
  const headers = await t.as('a@example.com');
  const address = {
    kind: 'domestic',
    municipality: '3550308',
    zip: '01001000',
    street: 'Praça da Sé',
    number: '1',
    district: 'Sé',
  };
  const response = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { email: 'contas@example.com', address },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ email: 'contas@example.com', address });

  new CustomerRepository(t.db).upsertImported(a, emitterId, { ...imported, name: 'Novo Nome Ltda' });
  const after = await t.app.inject({ method: 'GET', url, headers });
  expect(after.json()).toMatchObject({ name: 'Novo Nome Ltda', email: 'contas@example.com', address });
  expect(new AuditLog(t.db).latest(1)[0]).toMatchObject({ action: 'customer.edit', result: 'ok' });
});

test('a member can edit', async () => {
  const { url } = withCustomer({ role: 'member' });
  const response = await t.app.inject({
    method: 'PUT',
    url,
    headers: await t.as('a@example.com'),
    payload: { phone: '1133334444' },
  });
  expect(response.statusCode).toBe(200);
});

test('a suspended account cannot edit', async () => {
  const { url } = withCustomer({ status: 'suspended' });
  const response = await t.app.inject({
    method: 'PUT',
    url,
    headers: await t.as('a@example.com'),
    payload: { phone: '1133334444' },
  });
  expect(response.json()).toEqual({ error: 'account_suspended' });
});

test('another account gets 404 on GET and PUT', async () => {
  const { customerId } = withCustomer();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const headers = await t.as('b@example.com');
  const url = `/api/accounts/${b.accountId}/customers/${customerId}`;
  expect((await t.app.inject({ method: 'GET', url, headers })).statusCode).toBe(404);
  const put = await t.app.inject({ method: 'PUT', url, headers, payload: { phone: '1133334444' } });
  expect(put.statusCode).toBe(404);
});
