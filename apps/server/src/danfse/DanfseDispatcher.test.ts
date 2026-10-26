import type { AccountContext } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { KEY, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { invoices } from '../db/schema';
import { DanfseRepository } from '../repos/DanfseRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { DanfseDispatcher, type DanfseMetrics } from './DanfseDispatcher';
import { memoryQueue } from './queue';

let db: Database;
let close: () => void;
let a: AccountContext;
let emitterId: string;
let invoiceRepo: InvoiceRepository;
let queue: ReturnType<typeof memoryQueue>;
let metrics: { job: Mock<DanfseMetrics['job']>; render: Mock<DanfseMetrics['render']> };
let log: Mock<(msg: string, data?: object) => void>;
let dispatcher: DanfseDispatcher;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  invoiceRepo = new InvoiceRepository(db);
  queue = memoryQueue();
  metrics = { job: vi.fn<DanfseMetrics['job']>(), render: vi.fn<DanfseMetrics['render']>() };
  log = vi.fn<(msg: string, data?: object) => void>();
  dispatcher = new DanfseDispatcher({ repo: new DanfseRepository(db), queue, metrics, log });
  queue.listen(dispatcher.events());
});
afterEach(() => close());

const row = (id: string) => db.select().from(invoices).where(eq(invoices.id, id)).get();
const sync = (n: number) =>
  invoiceRepo.upsertSynced(
    a,
    emitterId,
    providerInvoice({
      accessKey: KEY.replace('0042', String(1000 + n).slice(-4)),
      number: String(n),
    }),
    null,
  ).id;

describe('sweep', () => {
  test('sweep enqueues a pending invoice with its mark and XML', async () => {
    const id = sync(1);
    expect(await dispatcher.sweep()).toBe(1);
    const [job] = queue.jobs;
    expect(job).toMatchObject({ invoiceId: id, mark: 'none' });
    const stored = row(id)?.xmlGzip;
    expect(stored).toBeTruthy();
    expect(gunzipSync(Buffer.from(job?.xmlGzipBase64 ?? '', 'base64')).toString()).toBe(
      gunzipSync(stored ?? Buffer.alloc(0)).toString(),
    );
    expect(row(id)?.pdfEnqueuedAt).not.toBeNull();
  });

  test('sweep enqueues at most 100 rows per run', async () => {
    for (let n = 1; n <= 150; n++) sync(n);
    expect(await dispatcher.sweep()).toBe(100);
    expect(queue.jobs).toHaveLength(100);
  });

  test('sweep with Redis down logs once, keeps rows pending, and does not throw', async () => {
    const ids = [sync(1), sync(2)];
    queue.add = async () => {
      throw new Error('Redis is not connected');
    };
    expect(await dispatcher.sweep()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    for (const id of ids) {
      expect(row(id)).toMatchObject({ pdfStatus: 'pending', pdfEnqueuedAt: null });
    }
  });
});

describe('events', () => {
  test('a completed job marks the row ready', async () => {
    const id = sync(1);
    await dispatcher.sweep();
    queue.complete(`${id}:none`);
    expect(row(id)?.pdfStatus).toBe('ready');
    expect(metrics.job).toHaveBeenCalledWith('completed');
  });

  test('a completed job for an old mark keeps the row pending, and the next sweep enqueues the new mark', async () => {
    const id = sync(1);
    await dispatcher.sweep();
    invoiceRepo.markCancelled(a, id);
    queue.complete(`${id}:none`);
    expect(row(id)?.pdfStatus).toBe('pending');
    expect(await dispatcher.sweep()).toBe(1);
    expect(queue.jobs.map((j) => j.mark)).toEqual(['cancelada']);
  });

  test('a final failure marks the row failed and counts it', async () => {
    const id = sync(1);
    await dispatcher.sweep();
    queue.fail(`${id}:none`, 'boom');
    expect(row(id)?.pdfStatus).toBe('failed');
    expect(metrics.job).toHaveBeenCalledWith('failed');
  });
});

describe('retry', () => {
  test('retry moves the row to pending, and the next sweep adds a fresh job', async () => {
    const id = sync(1);
    await dispatcher.sweep();
    queue.fail(`${id}:none`, 'boom');
    expect(await dispatcher.retry(id)).toBe(true);
    expect(row(id)?.pdfStatus).toBe('pending');
    expect(await dispatcher.sweep()).toBe(1);
    expect(queue.jobs.map((j) => j.invoiceId)).toEqual([id]);
  });

  test('retry of a row that is not failed returns false', async () => {
    expect(await dispatcher.retry(sync(1))).toBe(false);
  });
});

test('a failed row whose XML changes gets a fresh job with the new XML', async () => {
  const id = sync(1);
  await dispatcher.sweep();
  queue.fail(`${id}:none`, 'boom');
  const before = row(id)?.xmlGzip;
  invoiceRepo.upsertSynced(
    a,
    emitterId,
    providerInvoice({
      accessKey: KEY.replace('0042', '1001'),
      number: '1',
      xml: '<NFSe>changed</NFSe>',
    }),
    null,
  );
  expect(row(id)?.xmlGzip?.equals(before ?? Buffer.alloc(0))).toBe(false);
  expect(row(id)?.pdfStatus).toBe('pending');
  expect(await dispatcher.sweep()).toBe(1);
  const xml = gunzipSync(Buffer.from(queue.jobs[0]?.xmlGzipBase64 ?? '', 'base64')).toString();
  expect(xml).toBe('<NFSe>changed</NFSe>');
});
