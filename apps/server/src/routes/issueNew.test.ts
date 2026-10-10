import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository } from '../repos/CustomerRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const COMPETENCE = '2026-10-01';

// An onboarded emitter with a fiscal configuration, one service, and a Brazil and a foreign customer.
async function withNewInvoiceSetup(options: { fiscal?: boolean } = {}) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const headers = await t.as('owner@example.com');
  const base = `/api/accounts/${a.accountId}`;
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers, ...(payload ? { payload } : {}) });

  const onboard = await call('POST', '/emitters', {
    pfxBase64: cert.pfx.toString('base64'),
    password: cert.password,
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  expect(onboard.statusCode).toBe(201);
  const emitterId = onboard.json<{ id: string }>().id;
  if (options.fiscal !== false) {
    const fiscal = await call('PUT', `/emitters/${emitterId}/fiscal`, {
      simplesAnnex: 'III',
      simplesBand: 1,
      issRate: 200,
      ibscbsRegime: 'inside_das',
    });
    expect(fiscal.statusCode).toBe(200);
  }
  const service = await call('POST', `/emitters/${emitterId}/services`, {
    name: 'Desenvolvimento',
    nationalTaxCode: '010101',
    nbsCode: '115080000',
    description: 'Desenvolvimento de software',
    pisCofinsCst: '00',
    ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
  });
  expect(service.statusCode).toBe(201);
  const brazil = await call('POST', '/customers', {
    emitterId,
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Teste Ltda',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
  const abroad = await call('POST', '/customers', {
    emitterId,
    documentType: 'NIF',
    document: '00-0000000',
    name: 'Foreign Customer Inc',
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '99999',
      city: 'Testville',
      region: 'NY',
      street: '1 Example Street',
      number: '1',
      district: 'Downtown',
    },
  });
  return {
    a,
    call,
    emitterId,
    serviceId: service.json<{ id: string }>().id,
    brazilId: brazil.json<{ id: string }>().id,
    abroadId: abroad.json<{ id: string }>().id,
  };
}

function xmlOf(a: { accountId: string; userId: string }, invoiceId: string): string {
  return (
    new InvoiceRepository(t.db).xml({ ...a, role: 'owner', accountStatus: 'active' }, invoiceId) ??
    ''
  );
}

test('a Brazil invoice is issued with the service and the Simples percent, without pAliq', async () => {
  const s = await withNewInvoiceSetup();
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  expect(response.statusCode).toBe(201);
  const view = response.json<{ id: string; status: string }>();
  expect(view.status).toBe('issued');
  const xml = xmlOf(s.a, view.id);
  expect(xml).toContain('<xDescServ>Desenvolvimento de software</xDescServ>');
  expect(xml).toContain('<pTotTribSN>6.00</pTotTribSN>');
  expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
  expect(xml).not.toContain('<pAliq>');
  expect(xml).toContain('<CNPJ>11222333000181</CNPJ>');
});

test('a retained ISS takes the emitter ISS rate, and the overrides replace the defaults', async () => {
  const s = await withNewInvoiceSetup();
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
    issRetained: true,
    simplesPercent: 1120,
    description: 'Sprint de outubro',
  });
  const xml = xmlOf(s.a, response.json<{ id: string }>().id);
  expect(xml).toContain('<tpRetISSQN>2</tpRetISSQN>');
  expect(xml).toContain('<pAliq>2.00</pAliq>');
  expect(xml).toContain('<pTotTribSN>11.20</pTotTribSN>');
  expect(xml).toContain('<xDescServ>Sprint de outubro</xDescServ>');
});

test('an export invoice is issued with comExt in the foreign currency', async () => {
  const s = await withNewInvoiceSetup();
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.abroadId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 670321,
    foreignCurrency: '220',
    foreignAmountCents: 123400,
  });
  expect(response.json()).toMatchObject({ status: 'issued' });
  const xml = xmlOf(s.a, response.json<{ id: string }>().id);
  expect(xml).toContain('<tribISSQN>3</tribISSQN>');
  expect(xml).toContain('<tpMoeda>220</tpMoeda>');
  expect(xml).toContain('<vServMoeda>1234.00</vServMoeda>');
  expect(xml).toContain('<cClassTrib>410027</cClassTrib>');
});

test('a customer abroad without the foreign amount is invalid_amount', async () => {
  const s = await withNewInvoiceSetup();
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.abroadId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 670321,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'invalid_amount' });
});

test('without a fiscal configuration nothing is reserved', async () => {
  const s = await withNewInvoiceSetup({ fiscal: false });
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'fiscal_config_missing' });
  const invoices = new InvoiceRepository(t.db).list(
    { ...s.a, role: 'owner', accountStatus: 'active' },
    { limit: 10, offset: 0 },
  );
  expect(invoices.total).toBe(0);
});

test('a service or customer of another emitter is not found', async () => {
  const s = await withNewInvoiceSetup();
  for (const [ids, error] of [
    [{ serviceId: 'missing', customerId: s.brazilId }, 'service_not_found'],
    [{ serviceId: s.serviceId, customerId: 'missing' }, 'customer_not_found'],
  ] as const) {
    const response = await s.call('POST', '/invoices/new', {
      emitterId: s.emitterId,
      competence: COMPETENCE,
      serviceCents: 123400,
      ...ids,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error });
  }
});

test('the same Idempotency-Key twice issues once', async () => {
  const s = await withNewInvoiceSetup();
  const headers = await t.as('owner@example.com');
  const send = () =>
    t.app.inject({
      method: 'POST',
      url: `/api/accounts/${s.a.accountId}/invoices/new`,
      headers: { ...headers, 'idempotency-key': 'new-invoice-key-1' },
      payload: {
        emitterId: s.emitterId,
        customerId: s.brazilId,
        serviceId: s.serviceId,
        competence: COMPETENCE,
        serviceCents: 123400,
      },
    });
  const first = await send();
  const second = await send();
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
});

test('reconcile resends what was first sent, even after the customer was edited', async () => {
  const s = await withNewInvoiceSetup();
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  expect(issued.json()).toMatchObject({ status: 'unknown' });
  const { id } = issued.json<{ id: string }>();
  const edit = await s.call('PUT', `/customers/${s.brazilId}`, { name: 'Nome Novo Ltda' });
  expect(edit.statusCode).toBe(200);

  const reconciled = await s.call('POST', `/invoices/${id}/reconcile`, {});
  expect(reconciled.json()).toMatchObject({ id, status: 'issued' });
  expect(new AuditLog(t.db).list().some((e) => e.detail?.startsWith('resent'))).toBe(true);
  const xml = xmlOf(s.a, id);
  expect(xml).toContain('<xNome>Cliente Teste Ltda</xNome>');
  expect(xml).not.toContain('Nome Novo Ltda');
});

test('a CNPJ customer with an address abroad is refused before anything is reserved', async () => {
  const s = await withNewInvoiceSetup();
  const ctx = { ...s.a, role: 'owner' as const, accountStatus: 'active' as const };
  // A customer stored before the edit check existed.
  new CustomerRepository(t.db).setManual(ctx, s.brazilId, {
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '99999',
      city: 'Testville',
      region: 'NY',
      street: '1 Example Street',
      number: '1',
      district: 'Downtown',
    },
  });
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
    foreignCurrency: '220',
    foreignAmountCents: 100,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'customer_address_incomplete' });
  expect(new InvoiceRepository(t.db).list(ctx, { limit: 10, offset: 0 }).total).toBe(0);
});
