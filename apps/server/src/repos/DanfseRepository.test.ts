import type { AccountContext } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { KEY, providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { invoices } from '../db/schema';
import { DanfseRepository } from './DanfseRepository';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let emitterId: string;
let repo: DanfseRepository;
let invoiceRepo: InvoiceRepository;

const NOW = new Date('2026-10-26T12:00:00Z');
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000);

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
  repo = new DanfseRepository(db);
  invoiceRepo = new InvoiceRepository(db);
});
afterEach(() => close());

const row = (id: string) => db.select().from(invoices).where(eq(invoices.id, id)).get();
const syncEventKey = () => invoiceRepo.upsertSynced(a, emitterId, providerInvoice(), null).id;
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

describe('the invoice writers', () => {
  test('an issued invoice is pending until rendered', () => {
    const id = invoiceRepo.createPending(a, {
      emitterId,
      dpsId: 'D1',
      dpsSeries: '900',
      dpsNumber: 1,
      competence: '2026-09-30',
      serviceCents: 100,
      description: 'x',
      customerId: null,
      customerDocument: null,
      customerName: null,
      serviceCode: '010101',
      environment: 'producao_restrita',
      templateOf: null,
    });
    expect(row(id)?.pdfStatus).toBeNull();
    invoiceRepo.markIssued(a, id, providerInvoice());
    expect(row(id)).toMatchObject({ pdfStatus: 'pending', pdfEnqueuedAt: null });
    expect(invoiceRepo.get(a, id)?.pdfStatus).toBe('pending');
  });

  test('a synced invoice with XML is pending', () => {
    expect(row(sync(1))?.pdfStatus).toBe('pending');
  });

  test('a cancellation sets the invoice back to pending', () => {
    const id = syncEventKey();
    repo.markEnqueued(id, 'none', NOW);
    repo.markRendered(id, 'none', NOW);
    expect(row(id)?.pdfStatus).toBe('ready');
    invoiceRepo.recordEvent(a, emitterId, providerEvent());
    expect(row(id)).toMatchObject({
      status: 'cancelled',
      pdfStatus: 'pending',
      pdfEnqueuedAt: null,
    });
    repo.markEnqueued(id, 'cancelada', NOW);
    repo.markRendered(id, 'cancelada', NOW);
    expect(row(id)?.pdfStatus).toBe('ready');
    invoiceRepo.markCancelled(a, id);
    expect(row(id)?.pdfStatus).toBe('pending');
  });
});

describe('DanfseRepository', () => {
  test('due returns pending rows, never-enqueued first, at most `limit`', () => {
    const [x, y, z] = [sync(1), sync(2), sync(3)];
    repo.markEnqueued(x, 'none', minutesBefore(30));
    repo.markEnqueued(y, 'none', minutesBefore(60));
    const due = repo.due(NOW, 10);
    expect(due.map((d) => d.id)).toEqual([z, y, x]);
    expect(due[0]).toMatchObject({ status: 'issued', eventCodes: [] });
    expect(due[0]?.xmlGzip).toBeInstanceOf(Buffer);
    expect(repo.due(NOW, 2)).toHaveLength(2);
  });

  test('due skips rows enqueued less than 10 minutes ago and ready rows', () => {
    const fresh = sync(1);
    const done = sync(2);
    repo.markEnqueued(fresh, 'none', minutesBefore(5));
    repo.markEnqueued(done, 'none', minutesBefore(60));
    repo.markRendered(done, 'none', NOW);
    expect(repo.due(NOW, 10)).toEqual([]);
  });

  test('due lists the event codes of the invoice', () => {
    const id = syncEventKey();
    invoiceRepo.recordEvent(a, emitterId, providerEvent());
    expect(repo.due(NOW, 10).find((d) => d.id === id)?.eventCodes).toEqual(['101101']);
  });

  test('markRendered with an old mark keeps the row pending', () => {
    const id = sync(1);
    repo.markEnqueued(id, 'none', NOW);
    invoiceRepo.markCancelled(a, id);
    expect(repo.markRendered(id, 'none', NOW)).toBe(false);
    expect(row(id)?.pdfStatus).toBe('pending');
  });

  test('markRendered with the current mark makes the row ready', () => {
    const id = sync(1);
    repo.markEnqueued(id, 'none', NOW);
    expect(repo.markRendered(id, 'none', NOW)).toBe(true);
    expect(row(id)).toMatchObject({ pdfStatus: 'ready', pdfRenderedAt: NOW });
  });

  test('retry moves a failed row back to pending', () => {
    const id = sync(1);
    repo.markEnqueued(id, 'none', NOW);
    expect(repo.markFailed(id, 'cancelada')).toBe(false);
    expect(repo.markFailed(id, 'none')).toBe(true);
    expect(row(id)?.pdfStatus).toBe('failed');
    expect(repo.due(NOW, 10)).toEqual([]);
    expect(repo.retry(id)).toBe(true);
    expect(row(id)).toMatchObject({ pdfStatus: 'pending', pdfEnqueuedAt: null });
    expect(repo.retry(id)).toBe(false);
  });

  test('oldestPendingAt is the oldest enqueue time of a pending row, or null', () => {
    expect(repo.oldestPendingAt()).toBeNull();
    const x = sync(1);
    const y = sync(2);
    repo.markEnqueued(x, 'none', minutesBefore(5));
    repo.markEnqueued(y, 'none', minutesBefore(50));
    expect(repo.oldestPendingAt()).toEqual(minutesBefore(50));
  });
});
