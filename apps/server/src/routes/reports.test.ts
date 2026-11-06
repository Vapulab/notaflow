import { Readable } from 'node:stream';
import type { AccountContext } from '@notaflow/core';
import type { R2Client } from '@notaflow/r2';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { providerInvoice } from '../../test/providerData';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { invoiceReports } from '../db/schema';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
let stored: Map<string, Buffer>;

const fakeR2: Pick<R2Client, 'put' | 'get' | 'delete'> = {
  put: async (key, body) => {
    stored.set(key, body);
  },
  get: async (key) => {
    const body = stored.get(key);
    return body ? { body: Readable.from([body]), size: body.length } : null;
  },
  delete: async (key) => {
    stored.delete(key);
  },
};

beforeEach(() => {
  stored = new Map();
});
afterEach(() => t.close());

const A = 'a@example.com';

function seedEmitter(ctx: AccountContext, cnpj: string) {
  return new EmitterRepository(t.db).create(ctx, {
    cnpj,
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
}

async function setup(options: Parameters<typeof createTestApp>[0] = { reportsR2: fakeR2 }) {
  t = await createTestApp(options);
  const a = seedTenant(t.db, { accountName: 'A', email: A });
  const emitterId = seedEmitter(a, '12345678000195');
  new InvoiceRepository(t.db).upsertSynced(
    a,
    emitterId,
    providerInvoice({ environment: 'producao', competence: '2026-10-10' }),
    null,
  );
  return { a, emitterId };
}

const create = async (accountId: string, payload: object, email = A) =>
  t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/reports`,
    headers: await t.as(email),
    payload,
  });

const list = async (accountId: string, email = A) =>
  t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/reports`,
    headers: await t.as(email),
  });

const pdf = async (accountId: string, id: string, email = A) =>
  t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/reports/${id}/pdf`,
    headers: await t.as(email),
  });

const retry = async (accountId: string, id: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/reports/${id}/retry`,
    headers: await t.as(A),
    payload: {},
  });

const october = (emitterId: string) => ({ emitterId, period: 'month', month: '2026-10' });
const setRow = (id: string, values: Partial<typeof invoiceReports.$inferInsert>) =>
  t.db.update(invoiceReports).set(values).where(eq(invoiceReports.id, id)).run();
const idOf = (response: { json<T>(): T }) => response.json<{ report: { id: string } }>().report.id;

describe('invoice report routes', () => {
  test('creates, renders, lists, and downloads', async () => {
    const { a, emitterId } = await setup();
    const made = await create(a.accountId, october(emitterId));
    expect(made.statusCode).toBe(202);
    expect(made.json<{ report: { status: string } }>().report.status).toBe('pending');
    await t.reports?.runner.tick();
    const listed = (await list(a.accountId)).json<{
      reports: { id: string; status: string; invoiceCount: number; emitterName: string }[];
      total: number;
    }>();
    expect(listed.total).toBe(1);
    expect(listed.reports[0]).toMatchObject({
      id: idOf(made),
      status: 'ready',
      invoiceCount: 1,
      emitterName: 'EMPRESA TESTE LTDA',
    });
    const file = await pdf(a.accountId, idOf(made));
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(
      'attachment; filename="Relatorio-NFSe-12345678000195-2026-10.pdf"',
    );
    expect(file.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  }, 30_000);

  test('isolates accounts', async () => {
    const { a, emitterId } = await setup();
    const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
    const foreign = seedEmitter(b, '98765432000110');
    const other = await create(b.accountId, october(foreign), 'b@example.com');
    expect(other.statusCode).toBe(202);
    expect((await create(a.accountId, october(foreign))).statusCode).toBe(404);
    await create(a.accountId, october(emitterId));
    expect((await list(a.accountId)).json<{ total: number }>().total).toBe(1);
    expect((await pdf(a.accountId, idOf(other))).statusCode).toBe(404);
    expect((await retry(a.accountId, idOf(other))).statusCode).toBe(404);
  });

  test('validates the period', async () => {
    const { a, emitterId } = await setup();
    const bad = await create(a.accountId, { emitterId, period: 'month', month: '2026-13' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'period_invalid' });
    const long = await create(a.accountId, {
      emitterId,
      period: 'range',
      from: '2025-01-01',
      to: '2026-02-04',
    });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toMatchObject({ error: 'period_too_long' });
    const body = await create(a.accountId, { emitterId, period: 'week' });
    expect(body.json()).toMatchObject({ error: 'invalid_body' });
    const noEmitter = await create(a.accountId, { period: 'year', year: 2026 });
    expect(noEmitter.json()).toMatchObject({ error: 'invalid_body' });
  });

  test('accepts year and range periods', async () => {
    const { a, emitterId } = await setup();
    const year = await create(a.accountId, { emitterId, period: 'year', year: 2026 });
    expect(year.statusCode).toBe(202);
    const range = await create(a.accountId, {
      emitterId,
      period: 'range',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(range.statusCode).toBe(202);
  });

  test('refuses a report over the cap', async () => {
    const { a, emitterId } = await setup({ reportsR2: fakeR2, reportsMaxInvoices: 0 });
    const response = await create(a.accountId, october(emitterId));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'report_too_large' });
  });

  test('rate limits creates', async () => {
    const { a, emitterId } = await setup();
    for (let month = 1; month <= 10; month += 1) {
      const m = String(month).padStart(2, '0');
      const ok = await create(a.accountId, { emitterId, period: 'month', month: `2026-${m}` });
      expect(ok.statusCode).toBe(202);
    }
    const eleventh = await create(a.accountId, { emitterId, period: 'month', month: '2026-11' });
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json()).toMatchObject({ error: 'too_many_requests' });
  });

  test('does not duplicate an open request', async () => {
    const { a, emitterId } = await setup();
    const first = await create(a.accountId, october(emitterId));
    const second = await create(a.accountId, october(emitterId));
    expect(idOf(second)).toBe(idOf(first));
  });

  test('answers 409 before ready and 410 after expiry', async () => {
    const { a, emitterId } = await setup();
    const id = idOf(await create(a.accountId, october(emitterId)));
    const early = await pdf(a.accountId, id);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'report_not_ready' });
    await t.reports?.runner.tick();
    expect((await pdf(a.accountId, id)).statusCode).toBe(200);
    setRow(id, { expiresAt: new Date(Date.now() - 1000) });
    const late = await pdf(a.accountId, id);
    expect(late.statusCode).toBe(410);
    expect(late.json()).toMatchObject({ error: 'report_expired' });
    setRow(id, { status: 'expired' });
    expect((await pdf(a.accountId, id)).statusCode).toBe(410);
  }, 30_000);

  test('retries a failed report', async () => {
    const { a, emitterId } = await setup();
    const id = idOf(await create(a.accountId, october(emitterId)));
    const notFailed = await retry(a.accountId, id);
    expect(notFailed.statusCode).toBe(409);
    expect(notFailed.json()).toMatchObject({ error: 'report_not_failed' });
    setRow(id, { status: 'failed', errorCode: 'render_failed' });
    const again = await retry(a.accountId, id);
    expect(again.statusCode).toBe(202);
    expect(again.json<{ report: object }>().report).toMatchObject({
      status: 'pending',
      errorCode: null,
    });
    setRow(id, { status: 'failed', errorCode: 'emitter_removed' });
    const gone = await retry(a.accountId, id);
    expect(gone.statusCode).toBe(409);
    expect(gone.json()).toMatchObject({ error: 'emitter_removed' });
  });

  test('rate limits retries with the create limit', async () => {
    const { a, emitterId } = await setup();
    const ids: string[] = [];
    for (let month = 1; month <= 10; month += 1) {
      const m = String(month).padStart(2, '0');
      const ok = await create(a.accountId, { emitterId, period: 'month', month: `2026-${m}` });
      ids.push(idOf(ok));
    }
    const [first] = ids;
    if (!first) throw new Error('no report');
    setRow(first, { status: 'failed', errorCode: 'render_failed' });
    const blocked = await retry(a.accountId, first);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'too_many_requests' });
  });

  test('answers 503 when R2 is not set', async () => {
    const { a, emitterId } = await setup({});
    const response = await create(a.accountId, october(emitterId));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'reports_unavailable' });
    expect(t.reports).toBeNull();
  });

  test('records the audit rows for create and download', async () => {
    const { a, emitterId } = await setup();
    const id = idOf(await create(a.accountId, october(emitterId)));
    await t.reports?.runner.tick();
    await pdf(a.accountId, id);
    const rows = t.db.$client
      .prepare(
        "SELECT action, entity, result, detail FROM audit_log WHERE action LIKE 'report.%' ORDER BY id",
      )
      .all() as { action: string; entity: string; result: string; detail: string }[];
    expect(rows.map((r) => r.action)).toEqual(['report.create', 'report.download']);
    for (const row of rows) {
      expect(row.entity).toBe(id);
      expect(row.result).toBe('ok');
      expect(JSON.parse(row.detail)).toEqual({
        emitterId,
        period: { type: 'month', from: '2026-10-01', to: '2026-10-31' },
      });
    }
  }, 30_000);
});
