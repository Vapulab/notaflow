import { describe, expect, test } from 'vitest';
import { simplesBand, simplesBreakdown, simplesIssRate, simplesRate } from './simplesRates';

const reais = (value: number) => Math.round(value * 100);

describe('simplesBand', () => {
  test.each([
    [0, 1],
    [180_000, 1],
    [180_000.01, 2],
    [360_000, 2],
    [720_000.01, 4],
    [4_800_000, 6],
  ])('RBT12 R$ %s is band %s', (rbt12, band) => {
    expect(simplesBand(reais(rbt12))).toBe(band);
  });

  test('above R$ 4.8 million is outside the Simples', () => {
    expect(simplesBand(reais(4_800_000.01))).toBeNull();
  });
});

describe('simplesRate (LC 123/2006, annexes I to V)', () => {
  test("Lincoln's export: Anexo III, RBT12 just above R$ 180 thousand, gives 3.12%", () => {
    // Effective 6.13%; an export leaves out ISS (32%), Cofins (14.05%), and PIS (3.05%).
    expect(simplesRate('III', reais(184_700), { export: true })).toBe(312);
  });

  test('band 1 is the nominal rate: 6.00% at home, 3.05% on an export', () => {
    expect(simplesRate('III', reais(120_000), { export: false })).toBe(600);
    expect(simplesRate('III', reais(120_000), { export: true })).toBe(305);
  });

  test('a new company with no revenue yet uses band 1', () => {
    expect(simplesRate('III', 0, { export: false })).toBe(600);
  });

  test('the effective rate follows (RBT12 x rate - deduction) / RBT12', () => {
    // (500,000 x 13.5% - 17,640) / 500,000 = 9.972%
    expect(simplesRate('III', reais(500_000), { export: false })).toBe(997);
    // (500,000 x 19.5% - 9,900) / 500,000 = 17.52%
    expect(simplesRate('V', reais(500_000), { export: false })).toBe(1752);
  });

  test('Anexo V on an export leaves out its own ISS, Cofins, and PIS shares', () => {
    // Band 1: 15.5% x (1 - 14% - 14.10% - 3.05%) = 10.67%
    expect(simplesRate('V', reais(100_000), { export: true })).toBe(1067);
  });

  test('Anexo III band 5 above 14.92537% caps the ISS at 5% before the export leaves it out', () => {
    // RBT12 3,500,000: effective (735,000 - 125,640) / 3,500,000 = 17.4103%.
    // Export: 17.4103 - 5 (ISS) - (17.4103 - 5) x (19.28% + 4.18%) = 9.4987%.
    expect(simplesRate('III', reais(3_500_000), { export: true })).toBe(950);
  });

  test('Anexo III band 6 has no ISS share: an export leaves out only Cofins and PIS', () => {
    // (4,000,000 x 33% - 648,000) / 4,000,000 = 16.8%; x (1 - 16.03% - 3.47%) = 13.524%
    expect(simplesRate('III', reais(4_000_000), { export: true })).toBe(1352);
  });

  test('Anexo IV band 1 is 4.50%; an export leaves out ISS, Cofins, and PIS', () => {
    expect(simplesRate('IV', reais(142_050.29), { export: false })).toBe(450);
    // 4.5% x (1 - 44.5% - 17.67% - 3.83%) = 1.53%
    expect(simplesRate('IV', reais(142_050.29), { export: true })).toBe(153);
  });

  test('Anexo IV band 5 above 12.5% caps the ISS at 5% before the export leaves it out', () => {
    // RBT12 3,000,000: effective (660,000 - 183,780) / 3,000,000 = 15.874%.
    // Export: 15.874 - 5 (ISS) - (15.874 - 5) x (30.13% + 6.54%) = 6.8865%.
    expect(simplesRate('IV', reais(3_000_000), { export: true })).toBe(689);
  });

  test('Anexos I and II on an export leave out ICMS and IPI too', () => {
    expect(simplesRate('I', reais(100_000), { export: false })).toBe(400);
    // 4% x (1 - 12.74% - 2.76% - 34%) = 2.02%
    expect(simplesRate('I', reais(100_000), { export: true })).toBe(202);
    // 4.5% x (1 - 11.51% - 2.49% - 7.5% - 32%) = 2.0925%
    expect(simplesRate('II', reais(100_000), { export: true })).toBe(209);
    // Band 6: (760,000 - 378,000) / 4,000,000 = 9.55%, ICMS outside: x (1 - 28.27% - 6.13%)
    expect(simplesRate('I', reais(4_000_000), { export: true })).toBe(626);
  });

  test('outside the Simples there is no rate', () => {
    expect(() => simplesRate('III', reais(5_000_000), { export: false })).toThrow(RangeError);
  });
});

describe('simplesIssRate', () => {
  // CGSN 140, art. 27: a retained ISS is the effective ISS share of the band of the revenue.
  test.each([
    ['III', 54_000, 201],
    ['III', 216_000, 220],
    ['III', 180_000.01, 192],
    ['V', 100_000, 217],
    ['III', 2_000_000, 493],
    ['IV', 142_050.29, 200],
  ] as const)('Anexo %s, RBT12 %s: ISS %s hundredths', (annex, rbt12, iss) => {
    expect(simplesIssRate(annex, reais(rbt12))).toBe(iss);
  });

  test('Anexo III band 5 above the threshold: the ISS is capped at 5%', () => {
    expect(simplesIssRate('III', reais(3_500_000))).toBe(500);
  });

  test('Anexo IV band 5 above the threshold: the ISS is capped at 5%', () => {
    expect(simplesIssRate('IV', reais(3_000_000))).toBe(500);
  });

  test('Anexos I and II have no ISS share in the DAS', () => {
    expect(simplesIssRate('I', reais(100_000))).toBeNull();
    expect(simplesIssRate('II', reais(100_000))).toBeNull();
  });

  test('band 6 has no ISS share: the ISS goes outside the DAS, with the municipal rate', () => {
    expect(simplesIssRate('III', reais(4_000_000))).toBeNull();
    expect(simplesIssRate('V', reais(4_000_000))).toBeNull();
  });
});

// CGSN 140, art. 21 III b and art. 24 I: in band 6 the ISS stays in the DAS until the impediment of
// LC 123, art. 20 §1º and §1º-A, takes effect.
describe('band 6 with the ISS still in the DAS', () => {
  test('PGDAS-D manual, Exemplo 8: the part under the sublimit pays 18.60% + 6.09968%', () => {
    // Anexo III, RBT12 4,500,000: band 6 (1,485,000 - 648,000) / 4,500,000 = 18.60%;
    // ISS (945,000 - 125,640) / 4,500,000 x 33.50% = 6.09968%, capped at 5%.
    const under = simplesBreakdown('III', reais(4_500_000), {
      export: false,
      band6Iss: 'under_sublimit',
    });
    expect(under.percent).toBeCloseTo(24.69968, 9);
    expect(under.iss).toBe(5);
    // P1: the R$ 600,000.00 of the month under the R$ 3,600,000.00 sublimit.
    expect(Math.round((reais(600_000) * under.percent) / 100)).toBe(reais(148_198.08));
    expect(
      simplesRate('III', reais(4_500_000), { export: false, band6Iss: 'under_sublimit' }),
    ).toBe(2470);
  });

  test('Exemplo 8: the excess over the sublimit takes the ISS of band 5 at R$ 3.6 million', () => {
    // ISS (756,000 - 125,640) / 3,600,000 x 33.50% = 5.86585%, capped at 5%.
    const over = simplesBreakdown('III', reais(4_500_000), {
      export: false,
      band6Iss: 'over_sublimit',
    });
    expect(over.percent).toBeCloseTo(24.46585, 9);
    // P2 is R$ 97,863.39 in the manual, which rounds each tax on its own.
    expect(Math.round((reais(400_000) * over.percent) / 100)).toBe(reais(97_863.4));
    expect(simplesRate('III', reais(4_500_000), { export: false, band6Iss: 'over_sublimit' })).toBe(
      2447,
    );
  });

  test('a customer that retains the ISS in band 6 under the sublimit uses the capped 5%', () => {
    expect(simplesIssRate('III', reais(4_500_000), { band6Iss: 'under_sublimit' })).toBe(500);
    expect(simplesIssRate('III', reais(4_500_000), { band6Iss: 'over_sublimit' })).toBe(500);
    // Anexo IV: (880,000 - 183,780) / 4,000,000 x 40% = 6.9622%, capped at 5%.
    expect(simplesIssRate('IV', reais(4_000_000), { band6Iss: 'under_sublimit' })).toBe(500);
    // Anexo V at R$ 3.6 million: 21.275% x 23.50% = 4.99963%.
    expect(simplesIssRate('V', reais(4_000_000), { band6Iss: 'over_sublimit' })).toBe(500);
  });

  test('Anexo V caps the ISS at 5% too (LC 123, art. 18 §1º-B I)', () => {
    // (1,035,000 - 62,100) / 4,500,000 x 23.50% = 5.0807%; band 6 (1,372,500 - 540,000) / 4,500,000 = 18.50%.
    const v = simplesBreakdown('V', reais(4_500_000), {
      export: false,
      band6Iss: 'under_sublimit',
    });
    expect(v.iss).toBe(5);
    expect(v.percent).toBeCloseTo(23.5807, 9);
  });

  test('Anexo IV in band 6 under the sublimit adds the ISS of band 5', () => {
    // 12.30% + 6.9622%
    expect(simplesRate('IV', reais(4_000_000), { export: false, band6Iss: 'under_sublimit' })).toBe(
      1926,
    );
  });

  test('an export leaves out the band 6 Cofins and PIS, the ISS, and the Cofins and PIS of the excess', () => {
    // 18.60 x (1 - 16.03% - 3.47%) + 1.09968 x (1 - 19.28% - 4.18%) = 15.8147%
    expect(simplesRate('III', reais(4_500_000), { export: true, band6Iss: 'under_sublimit' })).toBe(
      1581,
    );
  });

  test('once the ISS leaves the DAS, band 6 has no ISS share', () => {
    expect(simplesIssRate('III', reais(4_500_000), { band6Iss: 'outside' })).toBeNull();
    expect(simplesRate('III', reais(4_500_000), { export: false, band6Iss: 'outside' })).toBe(1860);
    expect(simplesRate('III', reais(4_000_000), { export: true, band6Iss: 'outside' })).toBe(1352);
  });

  test('the answer changes nothing outside band 6, nor in Anexos I and II', () => {
    expect(simplesRate('III', reais(3_500_000), { export: true, band6Iss: 'under_sublimit' })).toBe(
      950,
    );
    expect(simplesIssRate('III', reais(2_000_000), { band6Iss: 'under_sublimit' })).toBe(493);
    expect(simplesIssRate('I', reais(4_000_000), { band6Iss: 'under_sublimit' })).toBeNull();
    expect(simplesRate('I', reais(4_000_000), { export: true, band6Iss: 'under_sublimit' })).toBe(
      626,
    );
  });
});
