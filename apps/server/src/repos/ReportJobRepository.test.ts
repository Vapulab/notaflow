import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import type { ReportPeriod } from '@notaflow/invoice-report';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { emitters, invoiceReports, invoices } from '../db/schema';
import { EmitterRepository } from './EmitterRepository';
import { ReportJobRepository } from './ReportJobRepository';
import { ReportRepository } from './ReportRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let emitterId: string;
let reports: ReportRepository;
let jobs: ReportJobRepository;

const OCTOBER: ReportPeriod = { type: 'month', from: '2026-10-01', to: '2026-10-31' };
const NOW = new Date('2026-11-06T12:00:00Z');

const newEmitter = (ctx: AccountContext, cnpj: string, companyName: string) =>
  new EmitterRepository(db).create(ctx, {
    cnpj,
    companyName,
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;

function seedInvoice(
  emitter: string,
  over: Partial<typeof invoices.$inferInsert> & { competence: string },
) {
  db.insert(invoices)
    .values({
      id: randomUUID(),
      emitterId: emitter,
      dpsSeries: '900',
      dpsNumber: 1,
      status: 'issued',
      environment: 'producao',
      serviceCode: '010101',
      description: 'Servico',
      serviceCents: 1000,
      netCents: 1000,
      origin: 'synced',
      ...over,
    })
    .run();
}

const setReport = (id: string, values: Partial<typeof invoiceReports.$inferInsert>) =>
  db.update(invoiceReports).set(values).where(eq(invoiceReports.id, id)).run();
const row = (id: string) => db.select().from(invoiceReports).where(eq(invoiceReports.id, id)).get();

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  emitterId = newEmitter(a, '12345678000195', 'EMPRESA TESTE LTDA');
  reports = new ReportRepository(db);
  jobs = new ReportJobRepository(db);
});
afterEach(() => close());

describe('ReportJobRepository.invoices', () => {
  test('lists invoices by competence at month edges, ordered by number', () => {
    seedInvoice(emitterId, { competence: '2026-09-30', number: '1' });
    seedInvoice(emitterId, { competence: '2026-10-01', number: '10' });
    seedInvoice(emitterId, { competence: '2026-10-31', number: '9' });
    seedInvoice(emitterId, { competence: '2026-11-01', number: '3' });
    seedInvoice(emitterId, {
      competence: '2026-10-15',
      number: '2',
      issuedAt: new Date('2026-11-02T12:00:00Z'),
    });
    seedInvoice(emitterId, { competence: '2026-10-16', number: null });
    reports.create(a, emitterId, OCTOBER);
    const job = jobs.claimNext(NOW);
    if (!job) throw new Error('no job');
    expect(jobs.invoices(job).map((r) => r.number)).toEqual(['2', '9', '10', null]);
  });

  test('filters environment, status, and deleted rows, and keeps cancelled', () => {
    seedInvoice(emitterId, { competence: '2026-10-10', environment: 'producao_restrita' });
    seedInvoice(emitterId, { competence: '2026-10-10', status: 'rejected' });
    seedInvoice(emitterId, { competence: '2026-10-10', status: 'pending' });
    seedInvoice(emitterId, { competence: '2026-10-10', deletedAt: new Date() });
    seedInvoice(emitterId, { competence: '2026-10-20', status: 'cancelled', number: '7' });
    reports.create(a, emitterId, OCTOBER);
    const job = jobs.claimNext(NOW);
    if (!job) throw new Error('no job');
    const listed = jobs.invoices(job);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ status: 'cancelled', number: '7' });
  });

  test('leaves out the invoices of another emitter', () => {
    const other = newEmitter(a, '98765432000110', 'OUTRA LTDA');
    seedInvoice(other, { competence: '2026-10-10' });
    reports.create(a, emitterId, OCTOBER);
    const job = jobs.claimNext(NOW);
    if (!job) throw new Error('no job');
    expect(jobs.invoices(job)).toEqual([]);
  });
});

describe('ReportJobRepository queue', () => {
  test('claimNext takes the oldest pending row and marks it running', () => {
    const first = reports.create(a, emitterId, OCTOBER);
    const second = reports.create(a, emitterId, {
      type: 'year',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    setReport(first.id, { createdAt: new Date('2026-11-01T00:00:00Z') });
    setReport(second.id, { createdAt: new Date('2026-11-02T00:00:00Z') });
    const job = jobs.claimNext(NOW);
    expect(job?.report).toMatchObject({ id: first.id, status: 'running', attempts: 1 });
    expect(job?.report.startedAt).toEqual(NOW);
    expect(job?.emitter).toEqual({
      legalName: 'EMPRESA TESTE LTDA',
      cnpj: '12345678000195',
      shortName: 'EMPRESA TESTE',
    });
    expect(jobs.claimNext(NOW)?.report.id).toBe(second.id);
    expect(jobs.claimNext(NOW)).toBeNull();
  });

  test('recoverRunning retries a first attempt and fails a second one with timeout', () => {
    const r = reports.create(a, emitterId, OCTOBER);
    jobs.claimNext(NOW);
    expect(jobs.recoverRunning()).toEqual({ retried: 1, failed: 0 });
    expect(row(r.id)).toMatchObject({ status: 'pending', attempts: 1 });
    jobs.claimNext(NOW);
    expect(jobs.recoverRunning()).toEqual({ retried: 0, failed: 1 });
    expect(row(r.id)).toMatchObject({ status: 'failed', errorCode: 'timeout', attempts: 2 });
  });

  test('failStale retries a first attempt and fails a second one with timeout', () => {
    const r = reports.create(a, emitterId, OCTOBER);
    const started = new Date(NOW.getTime() - 200_000);
    jobs.claimNext(started);
    expect(jobs.failStale(NOW, 300_000)).toEqual({ retried: 0, failed: 0 });
    expect(jobs.failStale(NOW, 120_000)).toEqual({ retried: 1, failed: 0 });
    expect(row(r.id)?.status).toBe('pending');
    jobs.claimNext(started);
    expect(row(r.id)?.attempts).toBe(2);
    expect(jobs.failStale(NOW, 120_000)).toEqual({ retried: 0, failed: 1 });
    expect(row(r.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });

  test('markReady and markFailed set the outcome', () => {
    const r = reports.create(a, emitterId, OCTOBER);
    const readyAt = NOW;
    const expiresAt = new Date(NOW.getTime() + 365 * 86_400_000);
    jobs.markReady(r.id, {
      r2Key: 'reports/x/y.pdf',
      invoiceCount: 3,
      pages: 2,
      bytes: 900,
      readyAt,
      expiresAt,
    });
    expect(row(r.id)).toMatchObject({
      status: 'ready',
      r2Key: 'reports/x/y.pdf',
      invoiceCount: 3,
      pages: 2,
      bytes: 900,
    });
    jobs.markFailed(r.id, 'render_failed');
    expect(row(r.id)).toMatchObject({ status: 'failed', errorCode: 'render_failed' });
  });

  test('dueForExpiry returns only ready rows that expired, and markExpired closes them', () => {
    const due = reports.create(a, emitterId, OCTOBER);
    const later = reports.create(a, emitterId, {
      type: 'year',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    const pending = reports.create(a, emitterId, {
      type: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    setReport(due.id, { status: 'ready', r2Key: 'k1', expiresAt: NOW });
    setReport(later.id, { status: 'ready', r2Key: 'k2', expiresAt: new Date(NOW.getTime() + 1) });
    setReport(pending.id, { expiresAt: new Date(NOW.getTime() - 1) });
    expect(jobs.dueForExpiry(NOW)).toEqual([{ id: due.id, r2Key: 'k1' }]);
    jobs.markExpired(due.id);
    expect(row(due.id)?.status).toBe('expired');
    expect(jobs.dueForExpiry(NOW)).toEqual([]);
  });

  test('oldestPendingAgeMs is null without pending rows, else the age of the oldest', () => {
    expect(jobs.oldestPendingAgeMs(NOW)).toBeNull();
    const r = reports.create(a, emitterId, OCTOBER);
    setReport(r.id, { createdAt: new Date(NOW.getTime() - 5_000) });
    expect(jobs.oldestPendingAgeMs(NOW)).toBe(5_000);
  });
});

describe('soft-deleted emitters', () => {
  const removeEmitter = (id: string) =>
    db.update(emitters).set({ deletedAt: NOW }).where(eq(emitters.id, id)).run();

  test('claimNext fails a pending report of a removed emitter and moves on', () => {
    const other = newEmitter(a, '98765432000110', 'OUTRA LTDA');
    const gone = reports.create(a, emitterId, OCTOBER);
    const kept = reports.create(a, other, OCTOBER);
    setReport(gone.id, { createdAt: new Date('2026-11-01T00:00:00Z') });
    setReport(kept.id, { createdAt: new Date('2026-11-02T00:00:00Z') });
    removeEmitter(emitterId);
    expect(jobs.claimNext(NOW)?.report.id).toBe(kept.id);
    expect(row(gone.id)).toMatchObject({ status: 'failed', errorCode: 'emitter_removed' });
  });

  test('invoices returns nothing for a removed emitter', () => {
    seedInvoice(emitterId, { competence: '2026-10-10', number: '1' });
    reports.create(a, emitterId, OCTOBER);
    const job = jobs.claimNext(NOW);
    if (!job) throw new Error('no job');
    removeEmitter(emitterId);
    expect(jobs.invoices(job)).toEqual([]);
  });

  test('list hides the reports of a removed emitter', () => {
    reports.create(a, emitterId, OCTOBER);
    removeEmitter(emitterId);
    expect(reports.list(a, 0, 10)).toEqual({ reports: [], total: 0 });
  });
});

describe('invoice_reports table', () => {
  test('refuses a delete', () => {
    reports.create(a, emitterId, OCTOBER);
    expect(() => db.delete(invoiceReports).run()).toThrow(/soft delete only/);
  });
});
