import type { ReportFields } from '@notaflow/provider-nacional';
import { describe, expect, it } from 'vitest';
import { monthPeriod, rangePeriod } from './period';
import { summarize } from './summarize';
import type { ReportRow } from './types';

type Overrides = {
  status?: ReportRow['status'];
  fields?: ReportFields | null;
  cents?: Partial<ReportFields['cents']>;
  extra?: Partial<ReportFields>;
};

function row(overrides: Overrides = {}): ReportRow {
  const fields: ReportFields | null =
    overrides.fields !== undefined
      ? overrides.fields
      : {
          competence: '2026-10-05',
          ...overrides.extra,
          cents: {
            service: null, net: null, iss: null, pis: null, cofins: null, ibsUf: null, ibsMun: null, cbs: null,
            retCp: null, retIrrf: null, retCsll: null, totalRet: null, discountUncond: null, discountCond: null,
            deduction: null,
            ...overrides.cents,
          },
        };
  return { status: overrides.status ?? 'issued', number: '1', customerName: null, customerDocument: null, fields };
}

const october = monthPeriod('2026-10');

describe('summarize', () => {
  it('sums issued rows only', () => {
    const s = summarize(
      [
        row({ cents: { service: 431065 } }),
        row({ cents: { service: 422728 } }),
        row({ status: 'cancelled', cents: { service: 3432563 } }),
      ],
      october,
    );
    expect(s.totals.service).toBe(853793);
    expect(s.issuedCount).toBe(2);
    expect(s.cancelledCount).toBe(1);
  });

  it('matches the sample formulas', () => {
    const s = summarize(
      [
        row({
          extra: { issWithholding: '2' },
          cents: { retCp: 37234401, retIrrf: 4586389, retCsll: 15721275, iss: 12865253, totalRet: 70407318, discountUncond: 1 },
        }),
      ],
      october,
    );
    const t = s.totals;
    expect(t.retCp).toBe(37234401);
    expect(t.retIrrf).toBe(4586389);
    expect(t.retCsll).toBe(15721275);
    expect(t.issRetained).toBe(12865253);
    expect(t.issNotRetained).toBe(0);
    expect(t.totalRet).toBe(70407318);
    expect(t.discounts).toBe(1);
    expect(t.retCp + t.retIrrf + t.retCsll + t.issRetained).toBe(t.totalRet);
  });

  it('splits ISS and IBS/CBS totals', () => {
    const s = summarize(
      [row({ extra: { issWithholding: '1' }, cents: { iss: 500, ibsUf: 10, ibsMun: 20, cbs: 30 } })],
      october,
    );
    expect(s.totals.issNotRetained).toBe(500);
    expect(s.totals.ibsCbs).toBe(60);
  });

  it('splits own PIS/COFINS by code', () => {
    const s = summarize([row({ extra: { pisCofinsWithholding: '5' }, cents: { pis: 410, cofins: 900 } })], october);
    expect(s.totals.ownPisCofins).toBe(900);
  });

  it('keeps rows with no XML out', () => {
    const s = summarize([row({ fields: null })], october);
    expect(s.missingXmlCount).toBe(1);
    expect(s.issuedCount).toBe(1);
    expect(s.totals.service).toBe(0);
  });

  it('labels months across a year change', () => {
    const s = summarize([], rangePeriod('2025-12-15', '2026-01-20'));
    expect(s.months.map((m) => m.label)).toEqual(['Dez/2025', 'Jan/2026']);
  });

  it('sums month lines by competence and keeps empty months', () => {
    const s = summarize(
      [
        row({ extra: { competence: '2026-01-10' }, cents: { service: 100, totalRet: 10, net: 90 } }),
        row({ extra: { competence: '2026-03-02' }, cents: { service: 200, totalRet: 20, net: 180 } }),
        row({ extra: { competence: '2026-03-20' }, cents: { service: 50, totalRet: 5, net: 45 } }),
      ],
      rangePeriod('2026-01-01', '2026-03-31'),
    );
    expect(s.months.map((m) => [m.month, m.count, m.service])).toEqual([
      ['2026-01', 1, 100],
      ['2026-02', 0, 0],
      ['2026-03', 2, 250],
    ]);
  });

  it('has no month lines for one month', () => {
    expect(summarize([row()], october).months).toEqual([]);
  });
});
