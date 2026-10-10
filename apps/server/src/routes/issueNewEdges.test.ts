import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { COMPETENCE, withNewInvoiceSetup, xmlOf } from '../../test/newInvoiceSetup';
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

type Setup = Awaited<ReturnType<typeof withNewInvoiceSetup>>;

const brazilInvoice = (s: Setup, extra: object = {}) => ({
  emitterId: s.emitterId,
  customerId: s.brazilId,
  serviceId: s.serviceId,
  competence: COMPETENCE,
  serviceCents: 123400,
  ...extra,
});

const exportInvoice = (s: Setup, extra: object = {}) => ({
  emitterId: s.emitterId,
  customerId: s.abroadId,
  serviceId: s.serviceId,
  competence: COMPETENCE,
  serviceCents: 617000,
  foreignCurrency: '220',
  foreignAmountCents: 123400,
  ...extra,
});

function invoiceCount(s: Setup): number {
  return new InvoiceRepository(t.db).list(
    { ...s.a, role: 'owner', accountStatus: 'active' },
    { limit: 50, offset: 0 },
  ).total;
}

async function expectRefused(s: Setup, payload: object, status: number, error?: string) {
  const response = await s.call('POST', '/invoices/new', payload);
  expect(response.statusCode, JSON.stringify(payload)).toBe(status);
  if (error) expect(response.json()).toMatchObject({ error });
}

test('inputs the XSD or the Sefin would refuse are refused before a number is reserved', async () => {
  const s = await withNewInvoiceSetup(t);
  await expectRefused(s, brazilInvoice(s, { simplesPercent: 10_000 }), 400);
  await expectRefused(s, brazilInvoice(s, { serviceCents: 1e17 }), 400);
  await expectRefused(s, exportInvoice(s, { foreignAmountCents: 1e17 }), 400);
  await expectRefused(s, brazilInvoice(s, { competence: '2026-02-30' }), 400, 'invalid_competence');
  await expectRefused(s, brazilInvoice(s, { competence: '2026-13-01' }), 400, 'invalid_competence');
  await expectRefused(s, brazilInvoice(s, { description: '   ' }), 400, 'invalid_description');
  await expectRefused(s, exportInvoice(s, { foreignCurrency: '999' }), 400, 'unsupported_currency');
  await expectRefused(
    s,
    brazilInvoice(s, { foreignCurrency: '220', foreignAmountCents: 100 }),
    400,
    'foreign_amount_not_allowed',
  );
  expect(invoiceCount(s)).toBe(0);
  expect(t.fake.issuedCount()).toBe(0);
});

test('an emitter that is not a Simples optant cannot issue without a template', async () => {
  const s = await withNewInvoiceSetup(t, { simplesNacional: '1' });
  await expectRefused(s, brazilInvoice(s), 409, 'emitter_not_simples');
  expect(invoiceCount(s)).toBe(0);
});

test('a Brazil invoice leaves out the IBSCBS group of an export service', async () => {
  const s = await withNewInvoiceSetup(t);
  const response = await s.call('POST', '/invoices/new', brazilInvoice(s));
  const xml = xmlOf(t, s.a, response.json<{ id: string }>().id);
  expect(xml).not.toContain('<IBSCBS>');
});

test('an archived service, or a service and customer of another emitter, are not found', async () => {
  const s = await withNewInvoiceSetup(t);
  const other = new EmitterRepository(t.db).create(
    { ...s.a, role: 'owner', accountStatus: 'active' },
    {
      cnpj: '11222333000181',
      companyName: 'OUTRA LTDA',
      municipality: '4113700',
      simplesNacional: '3',
      specialRegime: '0',
      dpsSeries: '900',
    },
  );
  const otherService = await s.call('POST', `/emitters/${other.id}/services`, {
    name: 'Outro',
    nationalTaxCode: '010101',
    description: 'Outro',
  });
  const otherCustomer = await s.call('POST', '/customers', {
    emitterId: other.id,
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
  await expectRefused(
    s,
    brazilInvoice(s, { serviceId: otherService.json<{ id: string }>().id }),
    404,
    'service_not_found',
  );
  await expectRefused(
    s,
    brazilInvoice(s, { customerId: otherCustomer.json<{ id: string }>().id }),
    404,
    'customer_not_found',
  );
  await s.call('PUT', `/services/${s.serviceId}`, {
    name: 'Desenvolvimento',
    nationalTaxCode: '010101',
    description: 'Desenvolvimento de software',
    archived: true,
  });
  await expectRefused(s, brazilInvoice(s), 404, 'service_not_found');
  expect(invoiceCount(s)).toBe(0);
});

test('a customer abroad without a document cannot be invoiced', async () => {
  const s = await withNewInvoiceSetup(t);
  const none = await s.call('POST', '/customers', {
    emitterId: s.emitterId,
    documentType: 'NONE',
    name: 'No Document Ltd',
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
  await expectRefused(
    s,
    exportInvoice(s, { customerId: none.json<{ id: string }>().id }),
    400,
    'customer_without_document',
  );
  expect(invoiceCount(s)).toBe(0);
});

test('an emitter of another account is not found and its DPS counter does not move', async () => {
  const s = await withNewInvoiceSetup(t);
  const b = await withNewInvoiceSetup(t, {
    email: 'b@example.com',
    cnpj: '11222333000181',
    accountName: 'B',
  });
  await expectRefused(s, { ...brazilInvoice(s), emitterId: b.emitterId }, 404, 'not_found');
  const ctxB = { ...b.a, role: 'owner' as const, accountStatus: 'active' as const };
  expect(new EmitterRepository(t.db).get(ctxB, b.emitterId)?.nextDpsNumber).toBe(1);
});

test('a member can issue; a suspended account cannot', async () => {
  const member = await withNewInvoiceSetup(t, { role: 'member' });
  expect((await member.call('POST', '/invoices/new', brazilInvoice(member))).statusCode).toBe(201);
  const suspended = await withNewInvoiceSetup(t, {
    email: 's@example.com',
    cnpj: '11222333000181',
    accountName: 'S',
    status: 'suspended',
  });
  await expectRefused(suspended, brazilInvoice(suspended), 403, 'account_suspended');
});

test('two requests at once with one Idempotency-Key issue one invoice', async () => {
  const s = await withNewInvoiceSetup(t);
  const send = () =>
    t.app.inject({
      method: 'POST',
      url: `${s.base}/invoices/new`,
      headers: { ...s.headers, 'idempotency-key': 'same-key-at-once' },
      payload: brazilInvoice(s),
    });
  const [first, second] = await Promise.all([send(), send()]);
  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
  expect(first.json<{ id: string }>().id).toBe(second.json<{ id: string }>().id);
  expect(invoiceCount(s)).toBe(1);
  expect(t.fake.issuedCount()).toBe(1);
});

test('a Sefin refusal is final: reconcile does not resend it, and the next issue takes a new number', async () => {
  const s = await withNewInvoiceSetup(t);
  t.fake.next('issue', {
    kind: 'reply',
    status: 400,
    body: { erros: [{ Codigo: 'E0625', Descricao: 'Aliquota nao permitida' }] },
  });
  const refused = await s.call('POST', '/invoices/new', brazilInvoice(s));
  expect(refused.statusCode).toBe(201);
  expect(refused.json()).toMatchObject({ status: 'rejected', errors: [{ code: 'E0625' }] });
  const { id } = refused.json<{ id: string }>();
  const reconciled = await s.call('POST', `/invoices/${id}/reconcile`, {});
  expect(reconciled.statusCode).toBe(409);
  const again = await s.call('POST', '/invoices/new', brazilInvoice(s));
  expect(again.json()).toMatchObject({ status: 'issued' });
  expect(xmlOf(t, s.a, again.json<{ id: string }>().id)).toContain('<nDPS>2</nDPS>');
});

test('reconcile adopts a built invoice the Sefin stored, without a resend', async () => {
  const s = await withNewInvoiceSetup(t);
  t.fake.next('issue', { kind: 'delay', ms: 600 });
  const issued = await s.call('POST', '/invoices/new', brazilInvoice(s));
  expect(issued.json()).toMatchObject({ status: 'unknown' });
  const { id } = issued.json<{ id: string }>();
  const reconciled = await s.call('POST', `/invoices/${id}/reconcile`, {});
  expect(reconciled.json()).toMatchObject({ id, status: 'issued' });
  expect(new AuditLog(t.db).list().some((e) => e.detail?.startsWith('resent'))).toBe(false);
  expect(t.fake.issuedCount()).toBe(1);
});

test('E0014: an invoice at the DPS number that matches ours is adopted; another one is not', async () => {
  const s = await withNewInvoiceSetup(t);
  // Number 1 holds someone else's invoice: another amount.
  await issueExportOnFake(t.fake, {
    number: 1,
    competence: COMPETENCE,
    amounts: { serviceCents: 999 },
  });
  const taken = await s.call('POST', '/invoices/new', exportInvoice(s));
  expect(taken.json()).toMatchObject({ status: 'rejected', errors: [{ code: 'E0014' }] });

  // Number 2 holds our own invoice, sent before an answer was lost.
  await issueExportOnFake(t.fake, {
    number: 2,
    competence: COMPETENCE,
    amounts: { serviceCents: 617000 },
    service: {
      municipality: '4113700',
      nationalTaxCode: '010101',
      description: 'Desenvolvimento de software',
    },
  });
  const ours = await s.call('POST', '/invoices/new', exportInvoice(s));
  expect(ours.json()).toMatchObject({ status: 'issued', accessKey: expect.any(String) });
});

test('an export amount in reais must be the foreign amount at the PTAX of the competence', async () => {
  const dates: string[] = [];
  const own = await createTestApp({
    exchangeRate: async (currency, date) => {
      dates.push(`${currency} ${date}`);
      return { currency, date: '2026-09-30', rateE4: 54321, source: 'PTAX venda, fechamento' };
    },
  });
  const s = await withNewInvoiceSetup(own);
  const wrong = await s.call('POST', '/invoices/new', exportInvoice(s, { serviceCents: 600000 }));
  expect(wrong.statusCode).toBe(400);
  // 1234.00 USD x 5.4321 = 6703.21 BRL
  expect(wrong.json()).toMatchObject({
    error: 'amount_ptax_mismatch',
    expectedCents: 670321,
    rate: '5.4321',
    rateDate: '2026-09-30',
  });
  expect(own.fake.issuedCount()).toBe(0);
  const right = await s.call('POST', '/invoices/new', exportInvoice(s, { serviceCents: 670321 }));
  expect(right.json()).toMatchObject({ status: 'issued' });
  expect(dates).toEqual([`USD ${COMPETENCE}`, `USD ${COMPETENCE}`]);
  expect(
    new AuditLog(own.db).list().some((e) => e.detail?.includes('PTAX 5.4321 of 2026-09-30')),
  ).toBe(true);
  await own.close();
});

test('without the PTAX an export is not issued', async () => {
  const own = await createTestApp({
    exchangeRate: async () => {
      throw new Error('olinda down');
    },
  });
  const s = await withNewInvoiceSetup(own);
  const response = await s.call(
    'POST',
    '/invoices/new',
    exportInvoice(s, { serviceCents: 617000 }),
  );
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'ptax_unavailable' });
  expect(own.fake.issuedCount()).toBe(0);
  await own.close();
});

test('a retained ISS below 2% is refused, except for the services the law exempts', async () => {
  const s = await withNewInvoiceSetup(t);
  const low = await s.call(
    'POST',
    '/invoices/new',
    brazilInvoice(s, { issRetained: true, issRate: 150 }),
  );
  expect(low.statusCode).toBe(400);
  expect(low.json()).toMatchObject({ error: 'invalid_iss_rate', minimum: '2.00' });
  const works = await s.call('POST', `/emitters/${s.emitterId}/services`, {
    name: 'Obra',
    nationalTaxCode: '070202',
    description: 'Execução de obra por empreitada',
  });
  const allowed = await s.call(
    'POST',
    '/invoices/new',
    brazilInvoice(s, {
      serviceId: works.json<{ id: string }>().id,
      issRetained: true,
      issRate: 150,
    }),
  );
  expect(allowed.json()).toMatchObject({ status: 'issued' });
  expect(xmlOf(t, s.a, allowed.json<{ id: string }>().id)).toContain('<pAliq>1.50</pAliq>');
});

test('a customer stored with an unknown municipality is refused before a number is reserved', async () => {
  const s = await withNewInvoiceSetup(t);
  const ctx = { ...s.a, role: 'owner' as const, accountStatus: 'active' as const };
  new CustomerRepository(t.db).setManual(ctx, s.brazilId, {
    address: {
      kind: 'domestic',
      municipality: '9999999',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
  await expectRefused(s, brazilInvoice(s), 400, 'unknown_municipality');
  expect(invoiceCount(s)).toBe(0);
});
