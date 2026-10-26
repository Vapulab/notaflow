import { makeTestCertificate } from '@notaflow/test-kit';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { providerEvent } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { certificates, invoices } from '../db/schema';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function onboarded(email = 'owner@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as(email),
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  expect(response.statusCode).toBe(201);
  return { a, emitterId: response.json<{ id: string }>().id };
}

async function synced() {
  const tenant = await onboarded();
  const keys = await issueOnFake(t.fake, 3);
  const sync = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${tenant.a.accountId}/emitters/${tenant.emitterId}/sync`,
    headers: await t.as('owner@example.com'),
    payload: {},
  });
  expect(sync.json()).toMatchObject({ invoices: 3, error: null });
  return { ...tenant, keys };
}

async function lookup(accountId: string, accessKey: string) {
  return t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey },
  });
}

test('lists synced invoices with paging and returns the detail and the XML', async () => {
  const { a } = await synced();
  const headers = await t.as('owner@example.com');
  const page = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices?limit=2`,
    headers,
  });
  expect(page.statusCode).toBe(200);
  const body = page.json<{ total: number; items: { id: string; number: string }[] }>();
  expect(body.total).toBe(3);
  expect(body.items).toHaveLength(2);

  const id = body.items[0]?.id ?? '';
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({ id, status: 'issued', events: [] });
  expect(detail.json()).toMatchObject({ sefinMessages: null, templateOf: null });

  const xml = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}/xml`,
    headers,
  });
  expect(xml.headers['content-type']).toContain('application/xml');
  expect(xml.headers['content-disposition']).toMatch(/^attachment; filename="NFSe-\d+\.xml"$/);
  expect(xml.body).toContain('<NFSe');
});

test('an invalid limit is 400', async () => {
  const { a } = await onboarded();
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices?limit=5000`,
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(400);
});

test('lookup stores an invoice found by access key through the sync path', async () => {
  const { a } = await onboarded();
  const [key] = await issueOnFake(t.fake, 1);
  const response = await lookup(a.accountId, ` ${(key ?? '').toLowerCase()} `);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ id: expect.any(String) });
  const customers = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/customers`,
    headers: await t.as('owner@example.com'),
  });
  expect(customers.json()).toEqual([expect.objectContaining({ name: 'Cliente Exemplo Ltda' })]);
});

test('lookup of a key whose CNPJ is not an emitter of the account is 404 and calls nothing', async () => {
  const { a } = await onboarded();
  t.fake.next('getNfse', { kind: 'reply', status: 500, body: 'must not be called' });
  const response = await lookup(a.accountId, '355030822' + '98765432000110' + '0'.repeat(27));
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'emitter_not_found' });
  // The queued 500 is still there, so the first lookup never called the Sefin.
  const after = await lookup(a.accountId, '355030822' + '12345678000195' + '9'.repeat(27));
  expect(after.statusCode).toBe(500);
});

test('lookup of an unknown key of the emitter is 404 invoice_not_found', async () => {
  const { a } = await onboarded();
  const response = await lookup(a.accountId, '355030822' + '12345678000195' + '9'.repeat(27));
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'invoice_not_found' });
});

test('a malformed key is 400 invalid_access_key', async () => {
  const { a } = await onboarded();
  const response = await lookup(a.accountId, 'abc');
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'invalid_access_key' });
});

test('another account sees none of the invoices', async () => {
  const { a } = await synced();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices`,
    headers: await t.as('b@example.com'),
  });
  expect(list.json()).toEqual({ items: [], total: 0 });
  const own = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers: await t.as('owner@example.com'),
  });
  expect(own.json()).toMatchObject({ total: 3 });
  const id = own.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  expect(id).not.toBe('');
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices/${id}`,
    headers: await t.as('b@example.com'),
  });
  expect(detail.statusCode).toBe(404);
});

async function danfseOf(accountId: string, id: string) {
  return t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/invoices/${id}/danfse`,
    headers: await t.as('owner@example.com'),
  });
}

async function firstInvoice(accountId: string) {
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/invoices`,
    headers: await t.as('owner@example.com'),
  });
  const first = list.json<{ items: { id: string; number: string; accessKey: string }[] }>()
    .items[0];
  if (!first) throw new Error('no invoice');
  return first;
}

async function pdfOf(response: { rawPayload: Buffer }) {
  const bytes = new Uint8Array(response.rawPayload);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { text } = await extractText(bytes, { mergePages: true });
  return { pages: doc.getPageCount(), text };
}

test('the route draws the DANFSe from the stored XML', async () => {
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toMatch(/^attachment; filename="DANFSe-\w+\.pdf"$/);
  const pdf = await pdfOf(response);
  expect(pdf.pages).toBe(1);
  expect(pdf.text).not.toMatch(/CANCELADA|SUBSTITUÍDA/);
});

test('an invoice with no XML answers 404 not_found', async () => {
  const { a, emitterId } = await onboarded();
  const invoices = new InvoiceRepository(t.db);
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: 'DPS355030821234567800019500900000000000000001',
    dpsSeries: '900',
    dpsNumber: 1,
    competence: '2026-09-30',
    serviceCents: 1000,
    description: 'Servico',
    customerId: null,
    customerDocument: null,
    customerName: null,
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: null,
  });
  invoices.markRejected(a, id, [{ code: 'E0001', message: 'rejected' }]);
  const response = await danfseOf(a.accountId, id);
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'not_found' });
});

test('a cancelled invoice prints CANCELADA', async () => {
  const { a, emitterId } = await synced();
  const first = await firstInvoice(a.accountId);
  new InvoiceRepository(t.db).recordEvent(
    a,
    emitterId,
    providerEvent({ accessKey: first.accessKey, code: '101101' }),
  );
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).text).toContain('CANCELADA');
});

test('an invoice with event 105102 prints SUBSTITUÍDA', async () => {
  const { a, emitterId } = await synced();
  const first = await firstInvoice(a.accountId);
  new InvoiceRepository(t.db).recordEvent(
    a,
    emitterId,
    providerEvent({ accessKey: first.accessKey, code: '105102' }),
  );
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).text).toContain('SUBSTITUÍDA');
});

test('the route works without an active certificate', async () => {
  const { a } = await synced();
  t.db.update(certificates).set({ active: false }).run();
  const first = await firstInvoice(a.accountId);
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).pages).toBe(1);
});

test('another account gets 404 on the DANFS-e route', async () => {
  const { a } = await synced();
  const own = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers: await t.as('owner@example.com'),
  });
  const id = own.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices/${id}/danfse`,
    headers: await t.as('b@example.com'),
  });
  expect(response.statusCode).toBe(404);
});

const STORED = Buffer.from('%PDF-1.7 stored in r2');

async function withR2(get: (key: string) => Promise<{ body: Readable; size: number | null } | null>) {
  await t.close();
  t = await createTestApp({ danfseR2: { get } });
}

function setPdfStatus(id: string, status: 'pending' | 'ready' | 'failed') {
  t.db.update(invoices).set({ pdfStatus: status }).where(eq(invoices.id, id)).run();
}

const onDemand = async () =>
  (await t.app.metrics.registry.getSingleMetricAsString('danfse_on_demand_total')).split('\n');

test('a ready invoice streams the PDF from R2', async () => {
  const keys: string[] = [];
  await withR2(async (key) => {
    keys.push(key);
    return { body: Readable.from([STORED]), size: STORED.length };
  });
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  setPdfStatus(first.id, 'ready');
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toMatch(/^attachment; filename="DANFSe-\w+\.pdf"$/);
  expect(response.rawPayload.equals(STORED)).toBe(true);
  expect(keys).toEqual([`danfse/${first.accessKey}.pdf`]);
  expect(await onDemand()).toContain('danfse_on_demand_total 0');
});

test('a ready invoice whose R2 object is missing is drawn on demand', async () => {
  await withR2(async () => null);
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  setPdfStatus(first.id, 'ready');
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).pages).toBe(1);
  expect(await onDemand()).toContain('danfse_on_demand_total 1');
});

test('an R2 error falls back to drawing on demand', async () => {
  await withR2(async () => {
    throw new Error('R2 answered 503');
  });
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  setPdfStatus(first.id, 'ready');
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).pages).toBe(1);
  expect(await onDemand()).toContain('danfse_on_demand_total 1');
});

test('a pending invoice is drawn on demand and counted', async () => {
  let calls = 0;
  await withR2(async () => {
    calls += 1;
    return null;
  });
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  setPdfStatus(first.id, 'pending');
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).pages).toBe(1);
  expect(calls).toBe(0);
  expect(await onDemand()).toContain('danfse_on_demand_total 1');
});

test('without the queue settings the route draws on demand', async () => {
  const { a } = await synced();
  const first = await firstInvoice(a.accountId);
  setPdfStatus(first.id, 'ready');
  const response = await danfseOf(a.accountId, first.id);
  expect(response.statusCode).toBe(200);
  expect((await pdfOf(response)).pages).toBe(1);
  expect(await onDemand()).toContain('danfse_on_demand_total 1');
});
