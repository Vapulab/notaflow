import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoices } from '../db/schema';
import { COMPETENCE, withNewInvoiceSetup, xmlOf } from '../../test/newInvoiceSetup';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository } from '../repos/CustomerRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('a Brazil invoice is issued with the service and the Simples percent, without pAliq', async () => {
  const s = await withNewInvoiceSetup(t);
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
  const xml = xmlOf(t, s.a, view.id);
  expect(xml).toContain('<xDescServ>Desenvolvimento de software</xDescServ>');
  expect(xml).toContain('<pTotTribSN>6.00</pTotTribSN>');
  expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
  expect(xml).not.toContain('<pAliq>');
  expect(xml).toContain('<CNPJ>11222333000181</CNPJ>');
});

test('a retained ISS takes the emitter ISS rate, and the overrides replace the defaults', async () => {
  const s = await withNewInvoiceSetup(t);
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
  const xml = xmlOf(t, s.a, response.json<{ id: string }>().id);
  expect(xml).toContain('<tpRetISSQN>2</tpRetISSQN>');
  expect(xml).toContain('<pAliq>2.00</pAliq>');
  expect(xml).toContain('<pTotTribSN>11.20</pTotTribSN>');
  expect(xml).toContain('<xDescServ>Sprint de outubro</xDescServ>');
});

test('an export invoice is issued with comExt in the foreign currency', async () => {
  const s = await withNewInvoiceSetup(t);
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.abroadId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 617000,
    foreignCurrency: '220',
    foreignAmountCents: 123400,
  });
  expect(response.json()).toMatchObject({ status: 'issued' });
  const xml = xmlOf(t, s.a, response.json<{ id: string }>().id);
  expect(xml).toContain('<tribISSQN>3</tribISSQN>');
  expect(xml).toContain('<tpMoeda>220</tpMoeda>');
  expect(xml).toContain('<vServMoeda>1234.00</vServMoeda>');
  expect(xml).toContain('<cClassTrib>410027</cClassTrib>');
  // RBT12 R$ 120,000 (band 1, Anexo III): 6% without ISS, Cofins, and PIS is 3.05%.
  expect(xml).toContain('<pTotTribSN>3.05</pTotTribSN>');
  expect(xml).toMatch(/<piscofins><CST>08<\/CST>/);
});

test('an emitter without the revenue of the last 12 months cannot issue until it says it', async () => {
  const s = await withNewInvoiceSetup(t);
  t.db.$client.prepare('UPDATE emitters SET simples_rbt12_cents = NULL').run();
  const body = {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  };
  const refused = await s.call('POST', '/invoices/new', body);
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toMatchObject({ error: 'simples_revenue_missing' });
  // A rate typed in the complete mode still issues.
  const typed = await s.call('POST', '/invoices/new', { ...body, simplesPercent: 600 });
  expect(typed.statusCode).toBe(201);
});

test('a customer abroad without the foreign amount is invalid_amount', async () => {
  const s = await withNewInvoiceSetup(t);
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.abroadId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 617000,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'invalid_amount' });
});

test('without a fiscal configuration nothing is reserved', async () => {
  const s = await withNewInvoiceSetup(t, { fiscal: false });
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
  const s = await withNewInvoiceSetup(t);
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
  const s = await withNewInvoiceSetup(t);
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
  const s = await withNewInvoiceSetup(t);
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
  const xml = xmlOf(t, s.a, id);
  expect(xml).toContain('<xNome>Cliente Teste Ltda</xNome>');
  expect(xml).not.toContain('Nome Novo Ltda');
});

test('a CNPJ customer with an address abroad is refused before anything is reserved', async () => {
  const s = await withNewInvoiceSetup(t);
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

test('retention is refused for a customer abroad or a CPF, and needs a rate above zero', async () => {
  const s = await withNewInvoiceSetup(t);
  const cpf = await s.call('POST', '/customers', {
    emitterId: s.emitterId,
    documentType: 'CPF',
    document: '11144477735',
    name: 'Pessoa Teste',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
  const cases = [
    [
      { customerId: s.abroadId, foreignCurrency: '220', foreignAmountCents: 100 },
      'retention_not_allowed',
    ],
    [{ customerId: cpf.json<{ id: string }>().id }, 'retention_not_allowed'],
    [{ customerId: s.brazilId, issRate: 0 }, 'invalid_iss_rate'],
  ] as const;
  for (const [extra, error] of cases) {
    const response = await s.call('POST', '/invoices/new', {
      emitterId: s.emitterId,
      serviceId: s.serviceId,
      competence: COMPETENCE,
      serviceCents: 123400,
      issRetained: true,
      ...extra,
    });
    expect(response.statusCode, error).toBe(400);
    expect(response.json()).toMatchObject({ error });
  }
  const ctx = { ...s.a, role: 'owner' as const, accountStatus: 'active' as const };
  expect(new InvoiceRepository(t.db).list(ctx, { limit: 10, offset: 0 }).total).toBe(0);
});

test('reconcile refuses an unreadable stored template before it audits or sends anything', async () => {
  const s = await withNewInvoiceSetup(t);
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  const { id } = issued.json<{ id: string }>();
  for (const broken of ['{not json', JSON.stringify({ version: 9, template: {} })]) {
    t.db.update(invoices).set({ issueTemplate: broken }).where(eq(invoices.id, id)).run();
    const reconciled = await s.call('POST', `/invoices/${id}/reconcile`, {});
    expect(reconciled.statusCode).toBe(422);
    expect(reconciled.json()).toMatchObject({ error: 'template_unreadable' });
  }
  expect(new AuditLog(t.db).list().some((e) => e.detail?.startsWith('resent'))).toBe(false);
  expect(t.fake.issuedCount()).toBe(0);
});

test('a local save failure after the Sefin issued answers unknown, not an error', async () => {
  const s = await withNewInvoiceSetup(t);
  const spy = vi.spyOn(InvoiceRepository.prototype, 'markIssued').mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  spy.mockRestore();
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ status: 'unknown' });
  const { id } = response.json<{ id: string }>();
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ entity: id, result: 'error' });
  const reconciled = await s.call('POST', `/invoices/${id}/reconcile`, {});
  expect(reconciled.json()).toMatchObject({ status: 'issued' });
});
