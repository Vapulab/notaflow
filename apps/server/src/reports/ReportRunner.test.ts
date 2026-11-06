import type { AccountContext } from '@notaflow/core';
import type { ReportPeriod } from '@notaflow/invoice-report';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { invoiceReports } from '../db/schema';
import { EmitterRepository } from '../repos/EmitterRepository';
import { ReportJobRepository } from '../repos/ReportJobRepository';
import { ReportRepository } from '../repos/ReportRepository';
import { RenderTimeoutError, type renderInThread } from './renderInThread';
import { ReportRunner } from './ReportRunner';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let db: Database;
let close: () => void;
let a: AccountContext;
let emitterId: string;
let reports: ReportRepository;
let jobs: ReportJobRepository;
let puts: { key: string; type: string }[];
let deletes: string[];
let r2Fail: { put: boolean };
let metrics: { reportRendered: Mock<(s: number, n: number) => void>; reportJob: Mock<(r: 'ready' | 'failed') => void> };

const r2 = {
  put: async (key: string, _body: Buffer, type: string) => {
    if (r2Fail.put) throw new Error('boom');
    puts.push({ key, type });
  },
  delete: async (key: string) => {
    deletes.push(key);
  },
};

const okRender: typeof renderInThread = async () => ({
  pdf: Buffer.from('%PDF-fake'),
  pages: 4,
  invoiceCount: 7,
});

const runner = (render: typeof renderInThread = okRender) =>
  new ReportRunner({ jobs, r2, render, metrics, now: () => NOW });

const period = (month: number): ReportPeriod => ({
  type: 'month',
  from: `2026-${String(month).padStart(2, '0')}-01`,
  to: `2026-${String(month).padStart(2, '0')}-28`,
});
const row = (id: string) => db.select().from(invoiceReports).where(eq(invoiceReports.id, id)).get();

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
  reports = new ReportRepository(db);
  jobs = new ReportJobRepository(db);
  puts = [];
  deletes = [];
  r2Fail = { put: false };
  metrics = { reportRendered: vi.fn(), reportJob: vi.fn() };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  close();
  vi.restoreAllMocks();
});

describe('ReportRunner', () => {
  test('renders a pending report', async () => {
    const report = reports.create(a, emitterId, period(10));
    await runner().tick();
    const done = row(report.id);
    const key = `reports/${a.accountId}/${report.id}.pdf`;
    expect(done).toMatchObject({ status: 'ready', r2Key: key, pages: 4, bytes: 9, invoiceCount: 7 });
    expect(done?.readyAt?.getTime()).toBe(NOW.getTime());
    expect(done?.expiresAt?.getTime()).toBe(NOW.getTime() + 365 * DAY);
    expect(puts).toEqual([{ key, type: 'application/pdf' }]);
    expect(metrics.reportJob).toHaveBeenCalledWith('ready');
    expect(metrics.reportRendered).toHaveBeenCalledWith(expect.any(Number), 7);
  });

  test('runs at most two at a time', async () => {
    const created = [1, 2, 3].map((m) => reports.create(a, emitterId, period(m)));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tick = runner(async (input) => {
      await gate;
      return okRender(input);
    }).tick();
    const statuses = created.map((r) => row(r.id)?.status).sort();
    expect(statuses).toEqual(['pending', 'running', 'running']);
    release();
    await tick;
  });

  test('fails on a render error', async () => {
    const report = reports.create(a, emitterId, period(10));
    await runner(async () => {
      throw new Error('row data here');
    }).tick();
    expect(row(report.id)).toMatchObject({ status: 'failed', errorCode: 'render_failed' });
    expect(metrics.reportJob).toHaveBeenCalledWith('failed');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('row data');
  });

  test('fails with timeout on a render timeout', async () => {
    const report = reports.create(a, emitterId, period(10));
    await runner(async () => {
      throw new RenderTimeoutError();
    }).tick();
    expect(row(report.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });

  test('fails on a storage error', async () => {
    const report = reports.create(a, emitterId, period(10));
    r2Fail.put = true;
    await runner().tick();
    expect(row(report.id)).toMatchObject({ status: 'failed', errorCode: 'storage_failed' });
    expect(metrics.reportJob).toHaveBeenCalledWith('failed');
  });

  test('recovers running rows on start', async () => {
    const report = reports.create(a, emitterId, period(10));
    jobs.claimNext(NOW);
    expect(row(report.id)?.status).toBe('running');
    const r = runner();
    expect(r.recoverOnStart()).toBe(1);
    await r.tick();
    expect(row(report.id)?.status).toBe('ready');
  });

  test('expires due reports and keeps a row whose delete failed', async () => {
    const due = reports.create(a, emitterId, period(9));
    const stuck = reports.create(a, emitterId, period(10));
    await runner().tick();
    const past = new Date(NOW.getTime() - DAY);
    for (const r of [due, stuck]) {
      db.update(invoiceReports).set({ expiresAt: past }).where(eq(invoiceReports.id, r.id)).run();
    }
    const stuckKey = `reports/${a.accountId}/${stuck.id}.pdf`;
    const flaky = {
      ...r2,
      delete: async (key: string) => {
        if (key === stuckKey) throw new Error('boom');
        deletes.push(key);
      },
    };
    const expiring = new ReportRunner({ jobs, r2: flaky, render: okRender, now: () => NOW });
    expect(await expiring.expire()).toBe(1);
    expect(deletes).toEqual([`reports/${a.accountId}/${due.id}.pdf`]);
    expect(row(due.id)?.status).toBe('expired');
    expect(row(stuck.id)?.status).toBe('ready');
  });
});
