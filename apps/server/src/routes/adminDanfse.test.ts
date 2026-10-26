import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { providerInvoice } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { type DanfseQueue, memoryQueue } from '../danfse/queue';
import { invoices } from '../db/schema';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
let queue: ReturnType<typeof memoryQueue>;
let invoiceId: string;

async function start(q: DanfseQueue | null) {
  t = await createTestApp(q ? { danfseQueue: q } : {});
  seedUser(t.db, 'admin@example.com', 'admin');
  const a = seedTenant(t.db, { accountName: 'Conta A', email: 'a@example.com' });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  invoiceId = new InvoiceRepository(t.db).upsertSynced(a, emitter.id, providerInvoice(), null).id;
  t.db.update(invoices).set({ pdfStatus: 'failed' }).where(eq(invoices.id, invoiceId)).run();
}

beforeEach(async () => {
  queue = memoryQueue();
  await start(queue);
});
afterEach(() => t.close());

const get = async (email = 'admin@example.com') =>
  t.app.inject({
    method: 'GET',
    url: '/api/admin/danfse/failed',
    headers: await t.as(email),
  });
const retry = async (id: string, email = 'admin@example.com') =>
  t.app.inject({
    method: 'POST',
    url: `/api/admin/danfse/${id}/retry`,
    payload: {},
    headers: await t.as(email),
  });

test('the admin lists the failed jobs with the account, without the XML or the customer', async () => {
  queue.fail(`${invoiceId}:none`, 'Render crashed');
  const response = await get();
  expect(response.statusCode).toBe(200);
  const { items } = response.json<{ items: Record<string, unknown>[] }>();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    invoiceId,
    accountName: 'Conta A',
    failedReason: 'Render crashed',
  });
  expect(Object.keys(items[0] ?? {}).sort()).toEqual(
    ['accessKey', 'accountName', 'failedAt', 'failedReason', 'invoiceId'].sort(),
  );
  expect(response.body).not.toContain('98765432000110');
});

test('retry answers 204 for a failed invoice and puts it back to pending', async () => {
  const response = await retry(invoiceId);
  expect(response.statusCode).toBe(204);
  const row = t.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  expect(row?.pdfStatus).toBe('pending');
});

test('retry answers 404 when the invoice is not failed', async () => {
  expect((await retry(invoiceId)).statusCode).toBe(204);
  expect((await retry(invoiceId)).statusCode).toBe(404);
  expect((await retry('missing')).statusCode).toBe(404);
});

test('a Redis failure answers 503 queue_unavailable', async () => {
  await t.close();
  await start({
    ...memoryQueue(),
    failed: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  const response = await get();
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: 'queue_unavailable' });
});

test('without a queue the list is empty and retry answers 404', async () => {
  await t.close();
  await start(null);
  expect((await get()).json()).toEqual({ items: [] });
  expect((await retry(invoiceId)).statusCode).toBe(404);
});

test('the admin routes refuse an anonymous request', async () => {
  const list = await t.app.inject({ method: 'GET', url: '/api/admin/danfse/failed' });
  expect(list.statusCode).toBe(401);
  const post = await t.app.inject({
    method: 'POST',
    url: `/api/admin/danfse/${invoiceId}/retry`,
    payload: {},
  });
  expect(post.statusCode).toBe(401);
});

test('the admin routes refuse a non-admin', async () => {
  expect((await get('a@example.com')).statusCode).toBe(403);
  expect((await retry(invoiceId, 'a@example.com')).statusCode).toBe(403);
});
