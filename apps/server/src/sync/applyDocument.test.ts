import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { readFileSync } from 'node:fs';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { ServiceRepository } from '../repos/ServiceRepository';
import { type ApplyCounts, applyDocument } from './applyDocument';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const repos = {
    customers: new CustomerRepository(db),
    invoices: new InvoiceRepository(db),
    services: new ServiceRepository(db),
  };
  const counts: ApplyCounts = { invoices: 0, events: 0, skipped: 0 };
  return { ctx, emitterId, repos, counts };
}

test('an invoice document stores the invoice and its customer', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'invoice', nsu: 1, invoice: providerInvoice() },
    counts,
  );
  expect(counts).toEqual({ invoices: 1, events: 0, skipped: 0 });
  const { items } = repos.invoices.list(ctx, { limit: 10, offset: 0 });
  expect(items).toMatchObject([
    { number: '42', status: 'issued', customerName: 'Cliente Exemplo Ltda' },
  ]);
  expect(repos.customers.list(ctx, { emitterId })).toHaveLength(1);
});

test('the same documents twice create nothing new', () => {
  const { ctx, emitterId, repos, counts } = setup();
  for (let round = 0; round < 2; round++) {
    applyDocument(
      repos,
      ctx,
      emitterId,
      { kind: 'invoice', nsu: 1, invoice: providerInvoice() },
      counts,
    );
    applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 2, event: providerEvent() }, counts);
  }
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).total).toBe(1);
  expect(repos.customers.list(ctx, {})).toHaveLength(1);
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('an event before its invoice still ends with a cancelled invoice', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 1, event: providerEvent() }, counts);
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'invoice', nsu: 2, invoice: providerInvoice() },
    counts,
  );
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('a skipped document only counts', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'skipped', nsu: 1, reason: 'received invoice' },
    counts,
  );
  expect(counts).toEqual({ invoices: 0, events: 0, skipped: 1 });
});

const exportXml = readFileSync(
  new URL(
    '../../../../packages/provider-nacional/test/fixtures/NFSE_EXPORT_FULL.xml',
    import.meta.url,
  ),
  'utf8',
);

test('invoices with the same service code and description import one service', () => {
  const { ctx, emitterId, repos, counts } = setup();
  for (const [nsu, accessKey] of [
    [1, '35503082212345678000195000000000004226100000000420'],
    [2, '35503082212345678000195000000000004326100000000430'],
  ] as const) {
    applyDocument(
      repos,
      ctx,
      emitterId,
      { kind: 'invoice', nsu, invoice: providerInvoice({ accessKey }) },
      counts,
    );
  }
  expect(repos.services.list(ctx, emitterId)).toEqual([
    expect.objectContaining({
      name: 'Consultoria em análise',
      nationalTaxCode: '010101',
      description: 'Consultoria em análise',
      origin: 'imported',
    }),
  ]);
});

test('an imported service takes the fiscal groups of the invoice XML', () => {
  const { ctx, emitterId, repos, counts } = setup();
  const invoice = providerInvoice({
    xml: exportXml,
    service: { nationalTaxCode: '010701', description: 'Serviços de TI para tomador no exterior' },
  });
  applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 1, invoice }, counts);
  expect(repos.services.list(ctx, emitterId)[0]).toMatchObject({
    nationalTaxCode: '010701',
    nbsCode: '115080000',
    pisCofinsCst: '00',
    ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
    export: {
      mode: '1',
      providerLink: '0',
      providerSupport: '01',
      customerSupport: '01',
      temporaryGoods: '1',
      mdic: '0',
    },
  });
});

// The export fixture without its export block is a Brazil invoice of the 01.07 item.
const domesticXml = (codes: string) =>
  exportXml
    .replace(/<comExt>.*<\/comExt>/, '')
    .replace('<cIndOp>100302</cIndOp>', `<cIndOp>${codes.slice(0, 6)}</cIndOp>`)
    .replace(
      '<CST>410</CST><cClassTrib>410027</cClassTrib>',
      `<CST>${codes.slice(6, 9)}</CST><cClassTrib>${codes.slice(9)}</cClassTrib>`,
    );
const domesticService = (codes: string) => {
  const { ctx, emitterId, repos, counts } = setup();
  const invoice = providerInvoice({
    xml: domesticXml(codes),
    service: { nationalTaxCode: '010701', description: 'Suporte técnico' },
  });
  applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 1, invoice }, counts);
  return repos.services.list(ctx, emitterId)[0];
};

test('an imported Brazil service does not save the codes that equal the Anexo VIII defaults', () => {
  const service = domesticService('050101000000001');
  expect(service).toMatchObject({ nationalTaxCode: '010701' });
  expect(service).not.toHaveProperty('ibsCbs');
  expect(service).not.toHaveProperty('export');
});

test('an imported Brazil service keeps codes that differ from the defaults', () => {
  expect(domesticService('100301000000001')).toMatchObject({
    ibsCbs: { operationCode: '100301', cst: '000', classCode: '000001' },
  });
});

test('a hand edit of an imported service is kept on the next sync', () => {
  const { ctx, emitterId, repos, counts } = setup();
  const document = { kind: 'invoice' as const, nsu: 1, invoice: providerInvoice() };
  applyDocument(repos, ctx, emitterId, document, counts);
  const [service] = repos.services.list(ctx, emitterId);
  if (!service) throw new Error('no service');
  repos.services.update(ctx, service.id, {
    ...service,
    name: 'Consultoria',
    description: 'Consultoria mensal',
  });
  applyDocument(repos, ctx, emitterId, document, counts);
  expect(repos.services.list(ctx, emitterId)).toEqual([
    expect.objectContaining({ name: 'Consultoria', description: 'Consultoria mensal' }),
  ]);
});

test('a service with the same code and description, made by hand, blocks the import', () => {
  const { ctx, emitterId, repos, counts } = setup();
  repos.services.create(ctx, emitterId, {
    name: 'Consultoria',
    nationalTaxCode: '010101',
    description: 'Consultoria em análise',
  });
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'invoice', nsu: 1, invoice: providerInvoice() },
    counts,
  );
  expect(repos.services.list(ctx, emitterId)).toEqual([
    expect.objectContaining({ name: 'Consultoria', origin: 'manual' }),
  ]);
});

test('an invoice issued by the app imports no service when the sync brings it back', () => {
  const { ctx, emitterId, repos, counts } = setup();
  const invoice = providerInvoice({
    service: { nationalTaxCode: '010101', description: 'Consultoria outubro/2026' },
  });
  const id = repos.invoices.createPending(ctx, {
    emitterId,
    dpsId: invoice.dps.id,
    dpsSeries: invoice.dps.series,
    dpsNumber: invoice.dps.number,
    competence: invoice.competence,
    serviceCents: invoice.amounts.serviceCents,
    description: invoice.service.description,
    customerId: null,
    customerDocument: '98765432000110',
    customerName: 'Cliente Exemplo Ltda',
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: null,
  });
  repos.invoices.markIssued(ctx, id, invoice);
  applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 1, invoice }, counts);
  expect(repos.services.list(ctx, emitterId)).toEqual([]);
});
