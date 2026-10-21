import { describe, expect, test } from 'vitest';
import * as simples from '../simples';
import { fatorR, rbt12Window, simplesMonth } from './simplesMonth';
import { BAND6_ISS, SIMPLES_ANNEXES, simplesRate, simplesShares } from './simplesRates';

const reais = (value: number) => Math.round(value * 100);
const sum = (values: Record<string, number | undefined>) =>
  Object.values(values).reduce<number>((total, value) => total + (value ?? 0), 0);
const LIMITS = [180_000, 360_000, 720_000, 1_800_000, 3_600_000, 4_800_000];

describe('simplesShares', () => {
  test('Anexo III band 1: 6.00%, split by the shares of the table', () => {
    const shares = simplesShares('III', reais(180_000));
    expect(shares).toMatchObject({
      band: 1,
      nominalRate: 600,
      deductionCents: 0,
      effectiveRate: 600,
      issCapped: false,
    });
    expect(shares.taxes).toEqual({ irpj: 24, csll: 21, cofins: 77, pis: 17, cpp: 260, iss: 201 });
    expect(sum(shares.taxes)).toBe(600);
  });

  test.each(
    SIMPLES_ANNEXES.flatMap((annex) => LIMITS.map((limit, i) => [annex, i + 1, limit] as const)),
  )('Anexo %s band %s: the shares add up to 100%%', (annex, band, limit) => {
    const shares = simplesShares(annex, reais(limit));
    expect(shares.band).toBe(band);
    expect(sum(shares.shares)).toBe(10_000);
  });

  test('Anexo IV has no CPP share: it is paid outside the DAS (art. 18 §5º-C)', () => {
    expect(simplesShares('IV', reais(300_000)).taxes.cpp).toBeUndefined();
  });

  test('the band limits: R$ 180,000.01 is band 2, above R$ 4.8 million is outside the Simples', () => {
    expect(simplesShares('III', 18_000_001).band).toBe(2);
    expect(simplesShares('III', 480_000_000).band).toBe(6);
    expect(() => simplesShares('III', 480_000_001)).toThrow(RangeError);
  });

  test('band 5 above 14.92537%: the ISS is 5% and the rest follows the cap shares of the note', () => {
    // (735,000 - 125,640) / 3,500,000 = 17.4103%; 12.4103% x 6.02%, 5.26%, 19.28%, 4.18%, 65.26%.
    const shares = simplesShares('III', reais(3_500_000));
    expect(shares.issCapped).toBe(true);
    expect(shares.effectiveRate).toBe(1741);
    expect(shares.taxes).toEqual({ irpj: 75, csll: 65, cofins: 239, pis: 52, cpp: 810, iss: 500 });
  });

  test('without a band 6 answer, the ISS is outside the DAS, as in simplesRate', () => {
    const shares = simplesShares('III', reais(4_500_000));
    expect(shares.taxes.iss).toBeUndefined();
    expect(shares.effectiveRate).toBe(1860);
  });

  test('every RBT12: the taxes add up to the effective rate, which is simplesRate', () => {
    // LC 123 art. 18 §1º-B II: a difference of hundredths goes to the largest share.
    for (const annex of SIMPLES_ANNEXES) {
      for (const band6Iss of [undefined, ...BAND6_ISS]) {
        const options = band6Iss ? { band6Iss } : {};
        for (let rbt12 = 0; rbt12 <= 480_000_000; rbt12 += 1_234_567) {
          const shares = simplesShares(annex, rbt12, options);
          expect(sum(shares.taxes)).toBe(shares.effectiveRate);
          expect(shares.effectiveRate).toBe(
            simplesRate(annex, rbt12, { export: false, ...options }),
          );
          expect(sum(shares.percents)).toBeCloseTo(shares.effectivePercent, 9);
        }
      }
    }
  });
});

describe('rbt12Window', () => {
  const history = (from: string, count: number) => {
    const revenues: Record<string, number> = {};
    const [year, month] = from.split('-').map(Number);
    for (let i = 0; i < count; i++) {
      const index = (year ?? 0) * 12 + (month ?? 1) - 1 + i;
      revenues[`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`] =
        (i + 1) * 100_000;
    }
    return revenues;
  };

  test('the 12 months before the month, not the month itself (art. 18 §1º)', () => {
    const window = rbt12Window({
      month: '2026-10',
      activityStart: '2025-08',
      revenues: history('2025-08', 15),
    });
    expect(window.rule).toBe('full');
    expect(window.months).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    // Months 3 to 14 of the history: (3 + ... + 14) x R$ 1,000.00.
    expect(window.rbt12Cents).toBe(102 * 100_000);
  });

  test('the first month of activity: its own revenue x 12 (CGSN 140 art. 22 §2º)', () => {
    // PGDAS-D manual 8.3: R$ 10,000.00 x 12 = R$ 120,000.00.
    expect(
      rbt12Window({
        month: '2018-02',
        activityStart: '2018-02',
        revenues: { '2018-02': reais(10_000) },
      }),
    ).toEqual({ rbt12Cents: reais(120_000), rule: 'first_month', months: ['2018-02'] });
  });

  test('month 2: the revenue of month 1 x 12 (art. 22 §3º)', () => {
    const window = rbt12Window({
      month: '2026-04',
      activityStart: '2026-03',
      revenues: { '2026-03': reais(5_000), '2026-04': reais(9_000) },
    });
    expect(window).toEqual({
      rbt12Cents: reais(60_000),
      rule: 'proportional',
      months: ['2026-03'],
    });
  });

  test('month 3: the average of months 1 and 2 x 12', () => {
    const window = rbt12Window({
      month: '2026-05',
      activityStart: '2026-03',
      revenues: { '2026-03': reais(5_000), '2026-04': reais(7_000), '2026-05': reais(100_000) },
    });
    expect(window).toEqual({
      rbt12Cents: reais(72_000),
      rule: 'proportional',
      months: ['2026-03', '2026-04'],
    });
  });

  test('a month with no revenue counts in the average (PGDAS-D manual 8.3)', () => {
    // Opened in 02/2018, PA 05/2018: (10,000 + 0 + 590,000) / 3 x 12 = 2,400,000.
    const window = rbt12Window({
      month: '2018-05',
      activityStart: '2018-02',
      revenues: { '2018-02': reais(10_000), '2018-04': reais(590_000) },
    });
    expect(window.rbt12Cents).toBe(reais(2_400_000));
    expect(window.months).toEqual(['2018-02', '2018-03', '2018-04']);
  });

  test('month 12 is still proportional; month 13 uses the 12 months (art. 22 §4º)', () => {
    const revenues = history('2025-01', 13);
    const month12 = rbt12Window({ month: '2025-12', activityStart: '2025-01', revenues });
    expect(month12.rule).toBe('proportional');
    expect(month12.months).toHaveLength(11);
    // (1 + ... + 11) x R$ 1,000.00 / 11 x 12
    expect(month12.rbt12Cents).toBe(72 * 100_000);
    const month13 = rbt12Window({ month: '2026-01', activityStart: '2025-01', revenues });
    expect(month13.rule).toBe('full');
    expect(month13.rbt12Cents).toBe(78 * 100_000);
  });

  test('an average that is not a whole cent rounds to the cent', () => {
    const window = rbt12Window({
      month: '2026-08',
      activityStart: '2026-01',
      revenues: { '2026-01': 100 },
    });
    // 100 x 12 / 7 = 171.43 cents
    expect(window.rbt12Cents).toBe(171);
  });

  test('a month before the start of activity, or a bad month, has no RBT12', () => {
    expect(() => rbt12Window({ month: '2026-01', activityStart: '2026-02', revenues: {} })).toThrow(
      RangeError,
    );
    expect(() => rbt12Window({ month: '2026-13', activityStart: '2026-02', revenues: {} })).toThrow(
      RangeError,
    );
  });
});

describe('fatorR', () => {
  const payroll = (total: number) => ({ salaries: total, proLabore: 0, fgts: 0, cpp: 0, other: 0 });

  test('at exactly 28% the activity uses Anexo III (CGSN 140 art. 25 §1º V)', () => {
    expect(fatorR({ payroll: payroll(reais(28_000)), rbt12Cents: reais(100_000) })).toEqual({
      ratioHundredths: 28,
      annex: 'III',
    });
  });

  test('at 27.99% it uses Anexo V', () => {
    expect(fatorR({ payroll: payroll(reais(27_990)), rbt12Cents: reais(100_000) })).toEqual({
      ratioHundredths: 27,
      annex: 'V',
    });
  });

  test('two decimals without rounding: 0.2774 is 0.27 (PGDAS-D manual 8.2.1)', () => {
    expect(
      fatorR({ payroll: payroll(reais(27_740)), rbt12Cents: reais(100_000) }).ratioHundredths,
    ).toBe(27);
    expect(fatorR({ payroll: payroll(reais(27_999.99)), rbt12Cents: reais(100_000) }).annex).toBe(
      'V',
    );
  });

  test('the payroll adds salaries, pró-labore, FGTS, CPP and the other items (art. 18 §24)', () => {
    const result = fatorR({
      payroll: {
        salaries: reais(10_000),
        proLabore: reais(12_000),
        fgts: reais(800),
        cpp: reais(5_000),
        other: reais(200),
      },
      rbt12Cents: reais(100_000),
    });
    expect(result).toEqual({ ratioHundredths: 28, annex: 'III' });
  });

  test('PGDAS-D manual, Exemplos 4 and 5: r = 0.50 is Anexo III, r = 0.20 is Anexo V', () => {
    expect(fatorR({ payroll: payroll(reais(250_000)), rbt12Cents: reais(500_000) })).toEqual({
      ratioHundredths: 50,
      annex: 'III',
    });
    expect(fatorR({ payroll: payroll(reais(100_000)), rbt12Cents: reais(500_000) })).toEqual({
      ratioHundredths: 20,
      annex: 'V',
    });
  });

  test('zero cases (CGSN 140 art. 26 §6º and §7º)', () => {
    // A payroll and no revenue: r = 0.28.
    expect(fatorR({ payroll: payroll(reais(1_000)), rbt12Cents: 0 })).toEqual({
      ratioHundredths: 28,
      annex: 'III',
    });
    // No payroll: r = 0.01, with or without revenue.
    expect(fatorR({ payroll: payroll(0), rbt12Cents: reais(100_000) })).toEqual({
      ratioHundredths: 1,
      annex: 'V',
    });
    expect(fatorR({ payroll: payroll(0), rbt12Cents: 0 })).toEqual({
      ratioHundredths: 1,
      annex: 'V',
    });
  });
});

describe('simplesMonth', () => {
  test('a retained ISS takes out only the ISS share (CGSN 140 art. 25 §9º II)', () => {
    const month = simplesMonth({
      rbt12Cents: reais(180_000),
      lines: [{ annex: 'III', kind: 'iss_retained', revenueCents: reais(10_000) }],
    });
    const [line] = month.lines;
    // 6.00% - 6.00% x 33.50%
    expect(line?.rate).toBe(399);
    expect(line?.taxes.iss).toBeUndefined();
    expect(line?.taxes).toEqual({
      irpj: 2_400,
      csll: 2_100,
      cofins: 7_692,
      pis: 1_668,
      cpp: 26_040,
    });
    expect(line?.dasCents).toBe(39_900);
    expect(month.totalCents).toBe(39_900);
    expect(line?.retainedIss).toBeNull();
  });

  test('the retained ISS rate uses the RBT12 of the month before the service (art. 27 I)', () => {
    // This month: band 2, (216,000 x 11.20% - 9,360) / 216,000 = 6.8667%, ISS 2.1973%.
    // The month before: RBT12 R$ 170,000.00, band 1, ISS 6% x 33.50% = 2.01%.
    const month = simplesMonth({
      rbt12Cents: reais(216_000),
      lines: [
        {
          annex: 'III',
          kind: 'iss_retained',
          revenueCents: reais(10_000),
          retainedIss: { rbt12Cents: reais(170_000) },
        },
      ],
    });
    const [line] = month.lines;
    expect(line?.rate).toBe(467);
    expect(line?.retainedIss).toEqual({ rate: 201, cents: reais(201) });
    // The retained ISS is paid by the customer, not in the DAS.
    expect(month.totalCents).toBe(line?.dasCents);
  });

  test('the retained ISS is 2% in the first month and 5% when the invoice shows no rate (art. 27 II, V)', () => {
    const line = (retainedIss: 'first_month' | 'not_on_invoice') =>
      simplesMonth({
        rbt12Cents: reais(120_000),
        lines: [{ annex: 'III', kind: 'iss_retained', revenueCents: reais(10_000), retainedIss }],
      }).lines[0]?.retainedIss;
    expect(line('first_month')).toEqual({ rate: 200, cents: reais(200) });
    expect(line('not_on_invoice')).toEqual({ rate: 500, cents: reais(500) });
  });

  test('an export takes out ISS, PIS and Cofins, as simplesRate does (art. 18 §14)', () => {
    const month = simplesMonth({
      rbt12Cents: reais(184_700),
      exportRbt12Cents: reais(184_700),
      lines: [{ annex: 'III', kind: 'export', revenueCents: reais(10_000) }],
    });
    const [line] = month.lines;
    expect(line?.rate).toBe(simplesRate('III', reais(184_700), { export: true }));
    expect(Object.keys(line?.taxes ?? {}).sort()).toEqual(['cpp', 'csll', 'irpj']);
  });

  test('an export line uses the RBT12 of the exports (CGSN 140 art. 23)', () => {
    const month = simplesMonth({
      rbt12Cents: reais(500_000),
      exportRbt12Cents: reais(100_000),
      lines: [
        { annex: 'III', kind: 'normal', revenueCents: reais(10_000) },
        { annex: 'III', kind: 'export', revenueCents: reais(10_000) },
      ],
    });
    expect(month.lines.map((line) => line.rate)).toEqual([997, 305]);
  });

  test('an export line without the RBT12 of the exports throws', () => {
    expect(() =>
      simplesMonth({
        rbt12Cents: reais(500_000),
        lines: [{ annex: 'III', kind: 'export', revenueCents: reais(10_000) }],
      }),
    ).toThrow(RangeError);
  });

  test('two activities: each line uses its own Anexo and the same RBT12', () => {
    // RBT12 R$ 300,000.00: Anexo III 8.08%, Anexo IV (27,000 - 8,100) / 300,000 = 6.30%.
    const month = simplesMonth({
      rbt12Cents: reais(300_000),
      lines: [
        { annex: 'III', kind: 'normal', revenueCents: reais(10_000) },
        { annex: 'IV', kind: 'normal', revenueCents: reais(5_000) },
      ],
    });
    expect(month.lines.map((line) => [line.rate, line.dasCents])).toEqual([
      // Each tax rounds on its own, as in Exemplo 8: 32.32 + 28.28 + 113.52 + 24.64 + 350.67 + 258.56.
      [808, reais(807.99)],
      [630, reais(315)],
    ]);
    expect(month.lines[1]?.taxes).toEqual({
      irpj: 6_237,
      csll: 4_788,
      cofins: 6_473,
      pis: 1_402,
      iss: 12_600,
    });
    expect(month.totalCents).toBe(reais(1_122.99));
  });

  test('no revenue in the month, or no RBT12: no DAS and the band 1 nominal rate', () => {
    const empty = simplesMonth({
      rbt12Cents: reais(100_000),
      lines: [{ annex: 'III', kind: 'normal', revenueCents: 0 }],
    });
    expect(empty.lines[0]).toMatchObject({ rate: 600, dasCents: 0 });
    expect(empty.totalCents).toBe(0);
    const newCompany = simplesMonth({
      rbt12Cents: 0,
      lines: [{ annex: 'V', kind: 'normal', revenueCents: 0 }],
    });
    expect(newCompany.lines[0]).toMatchObject({ rate: 1550, dasCents: 0 });
  });

  test('warnings: an RBT12 above R$ 3.6 million, and the 5% cap of the ISS', () => {
    const month = (rbt12Cents: number) =>
      simplesMonth({
        rbt12Cents,
        lines: [{ annex: 'III', kind: 'normal', revenueCents: reais(1_000) }],
      });
    expect(month(360_000_000).warnings).toEqual(['iss_cap']);
    expect(month(360_000_001).warnings).toEqual(['over_sublimit']);
    expect(month(reais(1_000_000)).warnings).toEqual([]);
    expect(() => month(480_000_001)).toThrow(RangeError);
  });

  test('without a band 6 answer, the ISS is outside the DAS; the line answer wins over the month one', () => {
    const line = { annex: 'III' as const, kind: 'normal' as const, revenueCents: reais(1_000) };
    const lines = [line];
    expect(simplesMonth({ rbt12Cents: reais(4_500_000), lines }).lines[0]?.rate).toBe(1860);
    expect(
      simplesMonth({ rbt12Cents: reais(4_500_000), band6Iss: 'under_sublimit', lines }).lines[0]
        ?.rate,
    ).toBe(2470);
    expect(
      simplesMonth({
        rbt12Cents: reais(4_500_000),
        band6Iss: 'under_sublimit',
        lines: [{ ...line, band6Iss: 'outside' }],
      }).lines[0]?.rate,
    ).toBe(1860);
  });

  // PGDAS-D manual, section 12: each tax is rounded to the cent on its own, and the DAS is their sum.
  test('PGDAS-D manual, Exemplo 2: Anexo III band 2, RBT12 R$ 300,000.00, RPA R$ 100,000.00', () => {
    const month = simplesMonth({
      rbt12Cents: reais(300_000),
      lines: [{ annex: 'III', kind: 'normal', revenueCents: reais(100_000) }],
    });
    expect(month.lines[0]?.rate).toBe(808);
    expect(month.lines[0]?.taxes).toEqual({
      irpj: reais(323.2),
      csll: reais(282.8),
      cofins: reais(1_135.24),
      pis: reais(246.44),
      cpp: reais(3_506.72),
      iss: reais(2_585.6),
    });
    expect(month.totalCents).toBe(reais(8_080));
  });

  test('PGDAS-D manual, Exemplo 4: fator R 0.50, Anexo III band 3, RPA R$ 10,000.00', () => {
    const { annex } = fatorR({
      payroll: { salaries: reais(250_000), proLabore: 0, fgts: 0, cpp: 0, other: 0 },
      rbt12Cents: reais(500_000),
    });
    const month = simplesMonth({
      rbt12Cents: reais(500_000),
      lines: [{ annex, kind: 'normal', revenueCents: reais(10_000) }],
    });
    expect(month.lines[0]?.taxes).toEqual({
      irpj: reais(39.89),
      csll: reais(34.9),
      cofins: reais(136.02),
      pis: reais(29.52),
      cpp: reais(432.78),
      iss: reais(324.09),
    });
    expect(month.totalCents).toBe(reais(997.2));
  });

  test('PGDAS-D manual, Exemplo 5: fator R 0.20, Anexo V band 3, RPA R$ 10,000.00', () => {
    const { annex } = fatorR({
      payroll: { salaries: reais(100_000), proLabore: 0, fgts: 0, cpp: 0, other: 0 },
      rbt12Cents: reais(500_000),
    });
    const month = simplesMonth({
      rbt12Cents: reais(500_000),
      lines: [{ annex, kind: 'normal', revenueCents: reais(10_000) }],
    });
    expect(month.lines[0]?.rate).toBe(1752);
    expect(month.lines[0]?.taxes).toEqual({
      irpj: reais(420.48),
      csll: reais(262.8),
      cofins: reais(261.4),
      pis: reais(56.59),
      cpp: reais(417.85),
      iss: reais(332.88),
    });
    expect(month.totalCents).toBe(reais(1_752));
  });

  test('PGDAS-D manual, Exemplo 8: band 6, R$ 600,000.00 under the sublimit and R$ 400,000.00 over it', () => {
    const month = simplesMonth({
      rbt12Cents: reais(4_500_000),
      lines: [
        { annex: 'III', kind: 'normal', revenueCents: reais(600_000), band6Iss: 'under_sublimit' },
        { annex: 'III', kind: 'normal', revenueCents: reais(400_000), band6Iss: 'over_sublimit' },
      ],
    });
    expect(month.lines[0]?.taxes).toEqual({
      irpj: reais(39_457.2),
      csll: reais(17_087.06),
      cofins: reais(19_161.59),
      pis: reais(4_148.32),
      cpp: reais(38_343.91),
      iss: reais(30_000),
    });
    expect(month.lines.map((line) => line.dasCents)).toEqual([reais(148_198.08), reais(97_863.39)]);
    expect(month.totalCents).toBe(reais(246_061.47));
    expect(month.warnings).toEqual(['over_sublimit', 'iss_cap']);
  });
});

test('the browser entry exports the calculation and the CNAE hint, nothing more', () => {
  expect(Object.keys(simples).sort()).toEqual([
    'BAND6_ISS',
    'SIMPLES_ANNEXES',
    'annexRule',
    'fatorR',
    'rbt12Window',
    'simplesBand',
    'simplesBreakdown',
    'simplesIssRate',
    'simplesMonth',
    'simplesRate',
    'simplesShares',
  ]);
});
