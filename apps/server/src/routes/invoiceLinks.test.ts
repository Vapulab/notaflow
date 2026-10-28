import { makeTestCertificate } from '@notaflow/test-kit';
import { eq } from 'drizzle-orm';
import { Readable } from 'node:stream';
import { extractText } from 'unpdf';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { providerEvent } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { invoices } from '../db/schema';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function setup() {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const created = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as('owner@example.com'),
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  const emitterId = created.json<{ id: string }>().id;
  await issueOnFake(t.fake, 1);
  await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`,
    headers: await t.as('owner@example.com'),
    payload: {},
  });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers: await t.as('owner@example.com'),
  });
  const first = list.json<{ items: { id: string; accessKey: string }[] }>().items[0];
  if (!first) throw new Error('no invoice');
  return { a, emitterId, invoice: first };
}

async function createLink(accountId: string, invoiceId: string, email = 'owner@example.com') {
  return t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/invoices/${invoiceId}/link`,
    headers: await t.as(email),
    payload: {},
  });
}

async function tokenOf(accountId: string, invoiceId: string) {
  const response = await createLink(accountId, invoiceId);
  expect(response.statusCode).toBe(200);
  const url = response.json<{ url: string }>().url;
  expect(url).toMatch(/^http:\/\/localhost:3000\/n\/[A-Za-z0-9_-]{43}$/);
  return url.split('/n/')[1] ?? '';
}

const pub = (token: string, suffix = '', remoteAddress = '203.0.113.1') =>
  t.app.inject({ method: 'GET', url: `/api/public/n/${token}${suffix}`, remoteAddress });

test('a member creates one stable link and the public page shows only the summary', async () => {
  const { a, invoice } = await setup();
  const token = await tokenOf(a.accountId, invoice.id);
  expect(await tokenOf(a.accountId, invoice.id)).toBe(token);
  const response = await pub(token);
  expect(response.statusCode).toBe(200);
  expect(response.headers['x-robots-tag']).toBe('noindex');
  expect(response.json()).toEqual({
    emitterName: expect.any(String),
    number: expect.any(String),
    issuedAt: expect.any(String),
    netCents: expect.any(Number),
    notice: null,
    testEnvironment: true,
  });
  expect(await t.app.metrics.registry.getSingleMetricAsString('danfse_link_views_total')).toContain(
    'danfse_link_views_total 1',
  );
});

test('the public summary never carries the customer, also a CPF customer', async () => {
  const { a, invoice } = await setup();
  t.db
    .update(invoices)
    .set({ customerDocument: '12345678909', customerName: 'Maria da Silva' })
    .where(eq(invoices.id, invoice.id))
    .run();
  const token = await tokenOf(a.accountId, invoice.id);
  const text = (await pub(token)).body;
  expect(text).not.toContain('Maria');
  expect(text).not.toContain('12345678909');
  expect(text).not.toMatch(/customer|tomador|cliente|document/i);
});

test('a guessed or revoked token answers 404 with the same body', async () => {
  const { a, invoice } = await setup();
  const guessed = await pub('x'.repeat(43));
  const token = await tokenOf(a.accountId, invoice.id);
  const revoke = () =>
    t.app.inject({
      method: 'DELETE',
      url: `/api/accounts/${a.accountId}/invoices/${invoice.id}/link`,
      headers: { origin: 'http://localhost:3000' },
    });
  expect((await revoke()).statusCode).toBe(401);
  const headers = await t.as('owner@example.com');
  const del = () =>
    t.app.inject({
      method: 'DELETE',
      url: `/api/accounts/${a.accountId}/invoices/${invoice.id}/link`,
      headers,
      payload: {},
    });
  expect((await del()).statusCode).toBe(204);
  const revoked = await pub(token);
  expect(guessed.statusCode).toBe(404);
  expect(revoked.statusCode).toBe(404);
  expect(revoked.body).toBe(guessed.body);
  expect((await pub(token, '/pdf')).statusCode).toBe(404);
  expect((await del()).statusCode).toBe(404);
});

test('the 61st request in a minute from one IP answers 429; another IP is not limited', async () => {
  for (let i = 0; i < 60; i += 1) expect((await pub('nope')).statusCode).toBe(404);
  expect((await pub('nope')).statusCode).toBe(429);
  expect((await pub('nope', '', '203.0.113.9')).statusCode).toBe(404);
});

test('a cancelled invoice behind an old link shows the notice and the watermarked PDF', async () => {
  const { a, emitterId, invoice } = await setup();
  const token = await tokenOf(a.accountId, invoice.id);
  new InvoiceRepository(t.db).recordEvent(
    a,
    emitterId,
    providerEvent({ accessKey: invoice.accessKey, code: '101101' }),
  );
  expect((await pub(token)).json()).toMatchObject({ notice: 'cancelada' });
  const pdf = await pub(token, '/pdf');
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
  expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="DANFSe-\w+\.pdf"$/);
  const { text } = await extractText(new Uint8Array(pdf.rawPayload), { mergePages: true });
  expect(text).toContain('CANCELADA');
});

test('a member of another account cannot create, read, or revoke the link', async () => {
  const { a, invoice } = await setup();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const token = await tokenOf(a.accountId, invoice.id);
  expect((await createLink(b.accountId, invoice.id, 'b@example.com')).statusCode).toBe(404);
  expect((await createLink(a.accountId, invoice.id, 'b@example.com')).statusCode).toBe(404);
  const revoke = await t.app.inject({
    method: 'DELETE',
    url: `/api/accounts/${b.accountId}/invoices/${invoice.id}/link`,
    headers: await t.as('b@example.com'),
    payload: {},
  });
  expect(revoke.statusCode).toBe(404);
  expect((await pub(token)).statusCode).toBe(200);
});

test('an invoice that is not issued or cancelled cannot be shared', async () => {
  const { a, invoice } = await setup();
  t.db.update(invoices).set({ status: 'pending' }).where(eq(invoices.id, invoice.id)).run();
  expect((await createLink(a.accountId, invoice.id)).statusCode).toBe(409);
});

test('the public PDF is drawn on demand when R2 is off', async () => {
  const { a, invoice } = await setup();
  const token = await tokenOf(a.accountId, invoice.id);
  const pdf = await pub(token, '/pdf');
  expect(pdf.statusCode).toBe(200);
  expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  expect(await t.app.metrics.registry.getSingleMetricAsString('danfse_on_demand_total')).toContain(
    'danfse_on_demand_total 1',
  );
});

test('the public PDF comes from R2 when ready', async () => {
  const stored = Buffer.from('%PDF-1.7 stored in r2');
  const keys: string[] = [];
  await t.close();
  t = await createTestApp({
    danfseR2: {
      get: async (key) => {
        keys.push(key);
        return { body: Readable.from([stored]), size: stored.length };
      },
    },
  });
  const { a, invoice } = await setup();
  t.db
    .update(invoices)
    .set({ pdfStatus: 'ready', pdfMark: 'none' })
    .where(eq(invoices.id, invoice.id))
    .run();
  const token = await tokenOf(a.accountId, invoice.id);
  const pdf = await pub(token, '/pdf');
  expect(pdf.rawPayload.equals(stored)).toBe(true);
  expect(keys).toEqual([`danfse/${invoice.accessKey}-none.pdf`]);
});

test('every public answer, also 404 and 429, is private and no-store', async () => {
  const { a, invoice } = await setup();
  const token = await tokenOf(a.accountId, invoice.id);
  const answers = [
    await pub(token),
    await pub(token, '/pdf'),
    await pub('x'.repeat(43)),
    await pub('x'.repeat(43), '/pdf'),
    await pub('x'.repeat(100)),
  ];
  expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 404, 404, 404]);
  for (let i = 0; i < 60; i += 1) await pub('nope');
  answers.push(await pub('nope'));
  expect(answers[5]?.statusCode).toBe(429);
  for (const response of answers) expect(response.headers['cache-control']).toBe('private, no-store');
});

test('the invoice detail says whether a link exists, and revoking clears it', async () => {
  const { a, invoice } = await setup();
  const headers = await t.as('owner@example.com');
  const hasLink = async () =>
    (
      await t.app.inject({
        method: 'GET',
        url: `/api/accounts/${a.accountId}/invoices/${invoice.id}`,
        headers,
      })
    ).json<{ hasLink: boolean }>().hasLink;
  expect(await hasLink()).toBe(false);
  await createLink(a.accountId, invoice.id);
  expect(await hasLink()).toBe(true);
  await t.app.inject({
    method: 'DELETE',
    url: `/api/accounts/${a.accountId}/invoices/${invoice.id}/link`,
    headers,
    payload: {},
  });
  expect(await hasLink()).toBe(false);
});
