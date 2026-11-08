import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { invoiceReports } from '../db/schema';
import { softDelete } from '../db/stamps';
import { EmitterRepository } from './EmitterRepository';
import { MetricsRepository } from './MetricsRepository';
import { ReportRepository } from './ReportRepository';

let db: Database;
let close: () => void;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

test('reportCounts groups the live reports by status and period', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const reports = new ReportRepository(db);
  reports.create(a, emitterId, { type: 'month', from: '2026-09-01', to: '2026-09-30' });
  reports.create(a, emitterId, { type: 'month', from: '2026-10-01', to: '2026-10-31' });
  reports.create(a, emitterId, { type: 'year', from: '2025-01-01', to: '2025-12-31' });
  const gone = reports.create(a, emitterId, { type: 'year', from: '2024-01-01', to: '2024-12-31' });
  softDelete(db, invoiceReports, gone.id, null);
  const counts = new MetricsRepository(db, ':memory:').reportCounts();
  expect(counts).toEqual(
    expect.arrayContaining([
      { status: 'pending', period: 'month', count: 2 },
      { status: 'pending', period: 'year', count: 1 },
    ]),
  );
  expect(counts).toHaveLength(2);
});
