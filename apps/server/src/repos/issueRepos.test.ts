import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository, isOwnInvoice } from './InvoiceRepository';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  return { a, b, emitterId };
}

test('reserveDpsNumber hands out 1, 2, 3 and never the same number twice', () => {
  const { a, b, emitterId } = setup();
  const emitters = new EmitterRepository(db);
  const numbers = [
    emitters.reserveDpsNumber(a, emitterId),
    emitters.reserveDpsNumber(a, emitterId),
    emitters.reserveDpsNumber(a, emitterId),
  ];
  expect(numbers).toEqual([1, 2, 3]);
  expect(() => emitters.reserveDpsNumber(b, emitterId)).toThrow(/not found/);
});

test('a pending row becomes issued with the provider invoice', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: 'DPS355030821234567800019500900000000000000042',
    dpsSeries: '900',
    dpsNumber: 42,
    competence: '2026-09-30',
    serviceCents: 150000,
    description: 'Consultoria',
    customerId: null,
    customerDocument: '98765432000110',
    customerName: 'Cliente Exemplo Ltda',
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: 'template-id',
    createdBy: a.userId,
  });
  expect(invoices.issueState(a, id)).toMatchObject({ status: 'pending', dpsNumber: 42 });
  invoices.markIssued(a, id, providerInvoice());
  expect(invoices.get(a, id)).toMatchObject({ status: 'issued', number: '42', origin: 'app' });
  expect(invoices.xml(a, id)).toBe('<NFSe>synthetic</NFSe>');
});

test('rejected and unknown keep the Sefin messages', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const base = {
    emitterId,
    dpsSeries: '900',
    competence: '2026-09-30',
    serviceCents: 150000,
    description: 'x',
    customerId: null,
    customerDocument: null,
    customerName: null,
    serviceCode: '010101',
    environment: 'producao_restrita' as const,
    templateOf: 't',
    createdBy: a.userId,
  };
  const rejected = invoices.createPending(a, { ...base, dpsId: 'D1', dpsNumber: 1 });
  invoices.markRejected(a, rejected, [{ code: 'E0001', message: 'Campo inválido' }]);
  expect(invoices.issueState(a, rejected)?.status).toBe('rejected');
  const unknown = invoices.createPending(a, { ...base, dpsId: 'D2', dpsNumber: 2 });
  invoices.markUnknown(a, unknown, 'timeout');
  expect(invoices.issueState(a, unknown)?.status).toBe('unknown');
});

test('a sync that brings an unknown invoice adopts its row instead of adding a second one', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const invoice = providerInvoice();
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: invoice.dps.id,
    dpsSeries: '900',
    dpsNumber: 42,
    competence: '2026-09-30',
    serviceCents: 150000,
    description: 'Consultoria em análise',
    customerId: null,
    customerDocument: '98765432000110',
    customerName: 'Cliente Exemplo Ltda',
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: 't',
    createdBy: a.userId,
  });
  invoices.markUnknown(a, id, 'timeout');
  expect(invoices.upsertSynced(a, emitterId, invoice, null)).toEqual({ id, created: false });
  expect(invoices.get(a, id)).toMatchObject({
    status: 'issued',
    origin: 'app',
    accessKey: invoice.accessKey,
  });
  expect(invoices.list(a, { limit: 10, offset: 0 }).total).toBe(1);
});

test('reserveDpsNumber skips the numbers the emitter already used in its series', () => {
  const { a, emitterId } = setup();
  // A synced invoice of the same series with DPS number 42, issued before the app.
  new InvoiceRepository(db).upsertSynced(a, emitterId, providerInvoice(), null);
  expect(new EmitterRepository(db).reserveDpsNumber(a, emitterId)).toBe(43);
});

test('a sync never adopts an invoice of another system that took the same DPS number', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const invoice = providerInvoice();
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: invoice.dps.id,
    dpsSeries: '900',
    dpsNumber: 42,
    competence: '2026-09-30',
    serviceCents: 99900,
    description: 'Outro serviço',
    customerId: null,
    customerDocument: '11222333000181',
    customerName: 'Outro Cliente',
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: 't',
    createdBy: a.userId,
  });
  invoices.markUnknown(a, id, 'timeout');
  expect(invoices.upsertSynced(a, emitterId, invoice, null).created).toBe(true);
  expect(invoices.issueState(a, id)?.status).toBe('rejected');
  expect(invoices.list(a, { limit: 10, offset: 0 }).total).toBe(2);
});

test('isOwnInvoice ignores line endings and outer spaces in the description', () => {
  const row = {
    competence: '2026-09-30',
    serviceCents: 150000,
    description: ' Consultoria\r\nem análise ',
    customerDocument: '98765432000110',
  };
  expect(
    isOwnInvoice(
      row,
      providerInvoice({
        service: { nationalTaxCode: '010101', description: 'Consultoria\nem análise' },
      }),
    ),
  ).toBe(true);
});
