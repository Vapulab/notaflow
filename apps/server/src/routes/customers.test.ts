import type { AccountContext, AccountRole } from '@notaflow/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { KEY, providerInvoice } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

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
  const a: AccountContext = seedTenant(t.db, {
    accountName: 'A',
    email: 'a@example.com',
    ...options,
  });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const customerId = new CustomerRepository(t.db).upsertImported(a, emitter.id, imported) ?? '';
  return {
    a,
    emitterId: emitter.id,
    customerId,
    url: `/api/accounts/${a.accountId}/customers/${customerId}`,
  };
}

test('GET returns the customer without its manual field list', async () => {
  const { url } = withCustomer();
  const response = await t.app.inject({ method: 'GET', url, headers: await t.as('a@example.com') });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    name: 'Cliente Exemplo Ltda',
    document: '98765432000110',
  });
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

  new CustomerRepository(t.db).upsertImported(a, emitterId, {
    ...imported,
    name: 'Novo Nome Ltda',
  });
  const after = await t.app.inject({ method: 'GET', url, headers });
  expect(after.json()).toMatchObject({
    name: 'Novo Nome Ltda',
    email: 'contas@example.com',
    address,
  });
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

describe('GET iss-retention', () => {
  const nfse = (retention: string, rate?: string) =>
    `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><DPS><infDPS><valores><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${retention}</tpRetISSQN>${rate ? `<pAliq>${rate}</pAliq>` : ''}</tribMun></trib></valores></infDPS></DPS></infNFSe></NFSe>`;

  function issue(
    a: AccountContext,
    emitterId: string,
    n: number,
    xml: string,
    status?: 'cancelled',
  ) {
    const invoices = new InvoiceRepository(t.db);
    const { id } = invoices.upsertSynced(
      a,
      emitterId,
      providerInvoice({
        accessKey: KEY.replace('0042', String(n).padStart(4, '0')),
        number: String(n),
        dps: { id: `DPS${n}`, series: '900', number: n },
        issuedAt: new Date(Date.UTC(2026, 9, n)),
        xml,
      }),
      null,
    );
    if (status) invoices.markCancelled(a, id);
  }

  async function retention(url: string) {
    const response = await t.app.inject({
      method: 'GET',
      url: `${url}/iss-retention`,
      headers: await t.as('a@example.com'),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  test('a customer whose last issued invoice had the ISS retained gets the retention and its rate', async () => {
    const { a, emitterId, url } = withCustomer();
    issue(a, emitterId, 1, nfse('1'));
    issue(a, emitterId, 2, nfse('2', '2.00'));
    expect(await retention(url)).toEqual({ retained: true, issRate: 200 });
  });

  test('a cancelled invoice does not count, and a not retained last invoice gives no retention', async () => {
    const { a, emitterId, url } = withCustomer();
    issue(a, emitterId, 1, nfse('2', '2.00'));
    issue(a, emitterId, 2, nfse('1'));
    issue(a, emitterId, 3, nfse('2', '3.00'), 'cancelled');
    expect(await retention(url)).toEqual({ retained: false });
  });

  test('a customer without invoices, or with an XML the parser cannot read, gets no retention', async () => {
    const { a, emitterId, url } = withCustomer();
    expect(await retention(url)).toEqual({ retained: false });
    issue(a, emitterId, 1, '<NFSe>synthetic</NFSe>');
    expect(await retention(url)).toEqual({ retained: false });
  });

  test('a customer of another account is not found', async () => {
    const { url } = withCustomer();
    seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
    const response = await t.app.inject({
      method: 'GET',
      url: `${url}/iss-retention`,
      headers: await t.as('b@example.com'),
    });
    expect(response.statusCode).toBe(404);
  });
});
