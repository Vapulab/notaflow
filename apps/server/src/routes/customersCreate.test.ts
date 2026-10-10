import type { AccountRole } from '@notaflow/core';
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

function withEmitter(options: { role?: AccountRole; status?: 'active' | 'suspended' } = {}) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com', ...options });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  return { a, emitterId: emitter.id, url: `/api/accounts/${a.accountId}/customers` };
}

const domesticAddress = {
  kind: 'domestic',
  municipality: '4113700',
  zip: '86010000',
  street: 'Rua Teste',
  number: '1',
  district: 'Centro',
};

const foreignAddress = {
  kind: 'foreign',
  country: 'US',
  postalCode: '99999',
  city: 'Testville',
  region: 'NY',
  street: '1 Example Street',
  number: '1',
  district: 'Downtown',
};

function brazil(emitterId: string) {
  return {
    emitterId,
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Teste Ltda',
    email: 'financeiro@example.com',
    address: domesticAddress,
  };
}

async function post(url: string, payload: object) {
  return t.app.inject({ method: 'POST', url, headers: await t.as('a@example.com'), payload });
}

test('a Brazil CNPJ customer with an address is created by hand and audited', async () => {
  const { a, emitterId, url } = withEmitter();
  const response = await post(url, brazil(emitterId));
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({
    emitterId,
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Teste Ltda',
    origin: 'manual',
    address: domesticAddress,
  });
  expect(response.json()).not.toHaveProperty('manualFields');
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    accountId: a.accountId,
    action: 'customer.create',
    result: 'ok',
  });
});

test('a sync of the same document keeps what was typed by hand', async () => {
  const { a, emitterId, url } = withEmitter();
  const id = ((await post(url, brazil(emitterId))).json() as { id: string }).id;
  new CustomerRepository(t.db).upsertImported(a, emitterId, {
    document: { type: 'CNPJ', value: '11222333000181' },
    name: 'NOME DA NOTA',
    email: 'outro@example.com',
  });
  expect(new CustomerRepository(t.db).get(a, id)).toMatchObject({
    name: 'Cliente Teste Ltda',
    email: 'financeiro@example.com',
  });
});

test('a CPF with wrong check digits is invalid_document', async () => {
  const { emitterId, url } = withEmitter();
  const response = await post(url, {
    ...brazil(emitterId),
    documentType: 'CPF',
    document: '52998224724',
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'invalid_document' });
});

test('a Brazil customer without municipality or CEP is customer_address_incomplete', async () => {
  const { emitterId, url } = withEmitter();
  const { zip: _zip, ...noZip } = domesticAddress;
  for (const payload of [
    { ...brazil(emitterId), address: noZip },
    { ...brazil(emitterId), address: undefined },
  ]) {
    const response = await post(url, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'customer_address_incomplete' });
  }
});

test('a customer abroad without a country is customer_country_missing', async () => {
  const { emitterId, url } = withEmitter();
  const { country: _country, ...noCountry } = foreignAddress;
  const response = await post(url, {
    emitterId,
    documentType: 'NIF',
    document: '00-0000000',
    name: 'Foreign Customer Inc',
    address: noCountry,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'customer_country_missing' });
});

test('a customer abroad without a document is accepted', async () => {
  const { emitterId, url } = withEmitter();
  const response = await post(url, {
    emitterId,
    documentType: 'NONE',
    name: 'Foreign Customer Inc',
    address: foreignAddress,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ documentType: 'NONE', document: null });
});

test('the same document twice for one emitter is customer_exists', async () => {
  const { emitterId, url } = withEmitter();
  expect((await post(url, brazil(emitterId))).statusCode).toBe(201);
  const again = await post(url, brazil(emitterId));
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ error: 'customer_exists' });
});

test('a member can create a customer', async () => {
  const { emitterId, url } = withEmitter({ role: 'member' });
  expect((await post(url, brazil(emitterId))).statusCode).toBe(201);
});

test('a suspended account cannot create a customer', async () => {
  const { emitterId, url } = withEmitter({ status: 'suspended' });
  expect((await post(url, brazil(emitterId))).statusCode).toBe(403);
});

test('an emitter of another account is not found', async () => {
  const { url } = withEmitter();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const other = new EmitterRepository(t.db).create(b, {
    cnpj: '11222333000181',
    companyName: 'OUTRA LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const response = await post(url, brazil(other.id));
  expect(response.statusCode).toBe(404);
});
