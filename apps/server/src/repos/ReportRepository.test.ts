import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import type { ReportPeriod } from '@notaflow/invoice-report';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { invoiceReports, invoices } from '../db/schema';
import { EmitterRepository } from './EmitterRepository';
import { ReportRepository } from './ReportRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let b: AccountContext;
let emitterId: string;
let repo: ReportRepository;

const OCTOBER: ReportPeriod = { type: 'month', from: '2026-10-01', to: '2026-10-31' };

const newEmitter = (ctx: AccountContext, cnpj: string) =>
  new EmitterRepository(db).create(ctx, {
    cnpj,
    companyName: 'EMPRESA TESTE LTDA',
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

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  emitterId = newEmitter(a, '12345678000195');
  repo = new ReportRepository(db);
});
afterEach(() => close());

describe('ReportRepository', () => {
  test('countInvoices counts by competence and filters environment, status, and deleted rows', () => {
    for (const competence of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
      seedInvoice(emitterId, { competence });
    }
    seedInvoice(emitterId, {
      competence: '2026-10-15',
      issuedAt: new Date('2026-11-02T12:00:00Z'),
    });
    seedInvoice(emitterId, { competence: '2026-10-10', environment: 'producao_restrita' });
    seedInvoice(emitterId, { competence: '2026-10-10', status: 'rejected' });
    seedInvoice(emitterId, { competence: '2026-10-10', status: 'pending' });
    seedInvoice(emitterId, { competence: '2026-10-10', deletedAt: new Date() });
    seedInvoice(emitterId, { competence: '2026-10-20', status: 'cancelled' });
    expect(repo.countInvoices(a, emitterId, OCTOBER)).toBe(4);
  });

  test('countInvoices returns null for an emitter of another account', () => {
    expect(repo.countInvoices(b, emitterId, OCTOBER)).toBeNull();
  });

  test('create reuses an open request of the same user, emitter, and period', () => {
    const first = repo.create(a, emitterId, OCTOBER);
    expect(first.status).toBe('pending');
    expect(repo.create(a, emitterId, OCTOBER).id).toBe(first.id);
    const other = repo.create(a, emitterId, {
      type: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(other.id).not.toBe(first.id);
  });

  test('create starts a new report once the earlier one is no longer open', () => {
    const first = repo.create(a, emitterId, OCTOBER);
    db.update(invoiceReports).set({ status: 'ready' }).run();
    expect(repo.create(a, emitterId, OCTOBER).id).not.toBe(first.id);
  });

  test('create refuses an emitter of another account', () => {
    expect(() => repo.create(b, emitterId, OCTOBER)).toThrow();
  });

  test('list shows only the account reports, newest first, with the creator name', () => {
    const older = repo.create(a, emitterId, OCTOBER);
    const newer = repo.create(a, emitterId, { type: 'year', from: '2026-01-01', to: '2026-12-31' });
    db.update(invoiceReports)
      .set({ createdAt: new Date('2026-11-01T10:00:00Z') })
      .where(eq(invoiceReports.id, older.id))
      .run();
    db.update(invoiceReports)
      .set({ createdAt: new Date('2026-11-02T10:00:00Z') })
      .where(eq(invoiceReports.id, newer.id))
      .run();
    repo.create(b, newEmitter(b, '98765432000110'), OCTOBER);
    const { reports, total } = repo.list(a, 0, 10);
    expect(total).toBe(2);
    expect(reports.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(reports[0]).toMatchObject({
      emitterName: 'EMPRESA TESTE LTDA',
      createdByName: 'a',
      period: { type: 'year', from: '2026-01-01', to: '2026-12-31' },
      status: 'pending',
      createdAt: '2026-11-02T10:00:00.000Z',
      readyAt: null,
      expiresAt: null,
    });
    expect(repo.list(a, 1, 1).reports.map((r) => r.id)).toEqual([older.id]);
  });

  test('a ready report past its expiry reads as expired', () => {
    const report = repo.create(a, emitterId, OCTOBER);
    const set = (expiresAt: Date) =>
      db
        .update(invoiceReports)
        .set({ status: 'ready', expiresAt })
        .where(eq(invoiceReports.id, report.id))
        .run();
    set(new Date(Date.now() + 86_400_000));
    expect(repo.view(a, report.id)?.status).toBe('ready');
    set(new Date(Date.now() - 1000));
    expect(repo.view(a, report.id)?.status).toBe('expired');
    expect(repo.list(a, 0, 10).reports[0]?.status).toBe('expired');
  });

  test('get and retry stay inside the account', () => {
    const report = repo.create(a, emitterId, OCTOBER);
    expect(repo.get(a, report.id)?.id).toBe(report.id);
    expect(repo.get(b, report.id)).toBeNull();
    expect(repo.retry(b, report.id)).toBeNull();
  });

  test('retry moves a failed report to pending and leaves other states alone', () => {
    const report = repo.create(a, emitterId, OCTOBER);
    expect(repo.retry(a, report.id)?.status).toBe('pending');
    db.update(invoiceReports).set({ status: 'failed', attempts: 2, errorCode: 'timeout' }).run();
    const retried = repo.retry(a, report.id);
    expect(retried).toMatchObject({ status: 'pending', attempts: 0, errorCode: null });
  });
});
