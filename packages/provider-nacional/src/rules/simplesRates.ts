// LC 123/2006, Anexos I to V (wording of LC 155/2016, in force since 2018), from the Planalto text.
// Rates and shares are in hundredths of a percent; the deduction and the band limits are in cents.
export const SIMPLES_ANNEXES = ['I', 'II', 'III', 'IV', 'V'] as const;
export type SimplesAnnex = (typeof SIMPLES_ANNEXES)[number];

export const SIMPLES_TAXES = [
  'irpj',
  'csll',
  'cofins',
  'pis',
  'cpp',
  'iss',
  'icms',
  'ipi',
] as const;
export type SimplesTax = (typeof SIMPLES_TAXES)[number];
export type TaxSplit = Partial<Record<SimplesTax, number>>;

// A tax outside the DAS has no share: the CPP of Anexo IV (art. 18, §5º-C), the ISS and ICMS of band 6.
interface Share extends TaxSplit {
  irpj: number;
  csll: number;
  cofins: number;
  pis: number;
}

interface Band {
  upTo: number;
  rate: number;
  deduction: number;
  share: Share;
}

const LIMITS = [18_000_000, 36_000_000, 72_000_000, 180_000_000, 360_000_000, 480_000_000];

const band = (index: number, rate: number, deductionReais: number, share: Share) => {
  const upTo = LIMITS[index];
  if (upTo === undefined) throw new RangeError(`No band ${index + 1}`);
  return { upTo, rate, deduction: deductionReais * 100, share };
};

const anexoI = (cpp: number, icms: number) => ({
  irpj: 550,
  csll: 350,
  cofins: 1274,
  pis: 276,
  cpp,
  icms,
});
const anexoII = { irpj: 550, csll: 350, cofins: 1151, pis: 249, cpp: 3750, ipi: 750, icms: 3200 };

// Band 6 prints no ICMS or ISS share (art. 13-A); simplesShares adds the ISS while it stays in the DAS.
const TABLES: Record<SimplesAnnex, Band[]> = {
  I: [
    band(0, 400, 0, anexoI(4150, 3400)),
    band(1, 730, 5_940, anexoI(4150, 3400)),
    band(2, 950, 13_860, anexoI(4200, 3350)),
    band(3, 1070, 22_500, anexoI(4200, 3350)),
    band(4, 1430, 87_300, anexoI(4200, 3350)),
    band(5, 1900, 378_000, { irpj: 1350, csll: 1000, cofins: 2827, pis: 613, cpp: 4210 }),
  ],
  II: [
    band(0, 450, 0, anexoII),
    band(1, 780, 5_940, anexoII),
    band(2, 1000, 13_860, anexoII),
    band(3, 1120, 22_500, anexoII),
    band(4, 1470, 85_500, anexoII),
    band(5, 3000, 720_000, { irpj: 850, csll: 750, cofins: 2096, pis: 454, cpp: 2350, ipi: 3500 }),
  ],
  III: [
    band(0, 600, 0, { irpj: 400, csll: 350, cofins: 1282, pis: 278, cpp: 4340, iss: 3350 }),
    band(1, 1120, 9_360, { irpj: 400, csll: 350, cofins: 1405, pis: 305, cpp: 4340, iss: 3200 }),
    band(2, 1350, 17_640, { irpj: 400, csll: 350, cofins: 1364, pis: 296, cpp: 4340, iss: 3250 }),
    band(3, 1600, 35_640, { irpj: 400, csll: 350, cofins: 1364, pis: 296, cpp: 4340, iss: 3250 }),
    band(4, 2100, 125_640, { irpj: 400, csll: 350, cofins: 1282, pis: 278, cpp: 4340, iss: 3350 }),
    band(5, 3300, 648_000, { irpj: 3500, csll: 1500, cofins: 1603, pis: 347, cpp: 3050 }),
  ],
  IV: [
    band(0, 450, 0, { irpj: 1880, csll: 1520, cofins: 1767, pis: 383, iss: 4450 }),
    band(1, 900, 8_100, { irpj: 1980, csll: 1520, cofins: 2055, pis: 445, iss: 4000 }),
    band(2, 1020, 12_420, { irpj: 2080, csll: 1520, cofins: 1973, pis: 427, iss: 4000 }),
    band(3, 1400, 39_780, { irpj: 1780, csll: 1920, cofins: 1890, pis: 410, iss: 4000 }),
    band(4, 2200, 183_780, { irpj: 1880, csll: 1920, cofins: 1808, pis: 392, iss: 4000 }),
    band(5, 3300, 828_000, { irpj: 5350, csll: 2150, cofins: 2055, pis: 445 }),
  ],
  V: [
    band(0, 1550, 0, { irpj: 2500, csll: 1500, cofins: 1410, pis: 305, cpp: 2885, iss: 1400 }),
    band(1, 1800, 4_500, { irpj: 2300, csll: 1500, cofins: 1410, pis: 305, cpp: 2785, iss: 1700 }),
    band(2, 1950, 9_900, { irpj: 2400, csll: 1500, cofins: 1492, pis: 323, cpp: 2385, iss: 1900 }),
    band(3, 2050, 17_100, { irpj: 2100, csll: 1500, cofins: 1574, pis: 341, cpp: 2385, iss: 2100 }),
    band(4, 2300, 62_100, { irpj: 2300, csll: 1250, cofins: 1410, pis: 305, cpp: 2385, iss: 2350 }),
    band(5, 3050, 540_000, { irpj: 3500, csll: 1550, cofins: 1644, pis: 356, cpp: 2950 }),
  ],
};

// Band 5 of Anexos III and IV: the ISS is at most 5%; above the threshold the rest is split like this.
// Anexo V prints no cap: its band 5 maximum (21.275%) stays under the threshold, so only band 6 uses it.
const BAND5_CAP: Partial<Record<SimplesAnnex, { threshold: number; split: TaxSplit }>> = {
  III: {
    threshold: 14.92537,
    split: { irpj: 0.0602, csll: 0.0526, cofins: 0.1928, pis: 0.0418, cpp: 0.6526 },
  },
  IV: { threshold: 12.5, split: { irpj: 0.3133, csll: 0.32, cofins: 0.3013, pis: 0.0654 } },
  // No printed split: the federal shares of band 5, in proportion.
  V: {
    threshold: 5 / 0.235,
    split: {
      irpj: 23 / 76.5,
      csll: 12.5 / 76.5,
      cofins: 14.1 / 76.5,
      pis: 3.05 / 76.5,
      cpp: 23.85 / 76.5,
    },
  },
};
const ISS_CAP = 5;
const SUBLIMIT = 360_000_000;

// Where a band 6 ISS goes (CGSN 140, art. 21 III b and art. 24 I; LC 123, art. 20 §1º and §1º-A).
export const BAND6_ISS = [
  'under_sublimit', // neither this year's nor last year's revenue passed R$ 3.6 million: in the DAS
  'over_sublimit', // this year's passed it; the ISS leaves the DAS next month or in January
  'outside', // last year's passed it, or the ISS already left this year: to the municipality
] as const;
export type Band6Iss = (typeof BAND6_ISS)[number];

export interface SimplesOptions {
  export: boolean;
  // Only band 6 reads it; without it, the ISS is outside the DAS.
  band6Iss?: Band6Iss;
}

// LC 123, art. 18 §14: an export takes these shares out of the DAS; IRPJ, CSLL and CPP stay.
export const EXPORT_LEAVES_OUT: readonly SimplesTax[] = ['cofins', 'pis', 'iss', 'icms', 'ipi'];

// The band of a gross revenue of the last 12 months (RBT12), or null above the Simples limit.
export function simplesBand(rbt12Cents: number): number | null {
  const index = LIMITS.findIndex((limit) => rbt12Cents <= limit);
  return index === -1 ? null : index + 1;
}

function bandRow(annex: SimplesAnnex, number: number | null): Band {
  const row = number === null ? undefined : TABLES[annex][number - 1];
  if (!row)
    throw new RangeError('A revenue above R$ 4,800,000.00 is outside the Simples Nacional.');
  return row;
}

// A company with no revenue yet pays the nominal rate of band 1.
function effectivePercent(row: Band, rbt12Cents: number): number {
  return rbt12Cents === 0
    ? row.rate / 100
    : (((rbt12Cents * row.rate) / 10_000 - row.deduction) / rbt12Cents) * 100;
}

function scaled(split: TaxSplit, factor: number): TaxSplit {
  const result: TaxSplit = {};
  for (const tax of SIMPLES_TAXES) {
    const share = split[tax];
    if (share !== undefined) result[tax] = share * factor;
  }
  return result;
}

// The percent of each tax in the DAS (art. 18 §1º-B), before a revenue takes any share out.
function percentsOf(annex: SimplesAnnex, rbt12Cents: number, band6Iss: Band6Iss) {
  const number = simplesBand(rbt12Cents) ?? 0;
  const row = bandRow(annex, number);
  const effective = effectivePercent(row, rbt12Cents);
  const cap = BAND5_CAP[annex];
  const band5 = bandRow(annex, 5);
  if (number === 6 && band6Iss !== 'outside' && band5.share.iss !== undefined && cap) {
    // The band 5 formula on the RBT12, or on the sublimit for the revenue above it.
    const base = band6Iss === 'under_sublimit' ? rbt12Cents : SUBLIMIT;
    const fullIss = (effectivePercent(band5, base) * band5.share.iss) / 10_000;
    const iss = Math.min(fullIss, ISS_CAP);
    const percents = scaled(row.share, effective / 10_000);
    const excess = scaled(cap.split, fullIss - iss);
    for (const tax of SIMPLES_TAXES) {
      const extra = excess[tax];
      if (extra !== undefined) percents[tax] = (percents[tax] ?? 0) + extra;
    }
    return { number, row, percents: { ...percents, iss }, issCapped: fullIss > ISS_CAP };
  }
  if (number === 5 && cap !== undefined && effective > cap.threshold) {
    const percents = scaled(cap.split, effective - ISS_CAP);
    return { number, row, percents: { ...percents, iss: ISS_CAP }, issCapped: true };
  }
  return { number, row, percents: scaled(row.share, effective / 10_000), issCapped: false };
}

// The sum of the percents, without the shares that a revenue takes out of the DAS.
export function percentWithout(percents: TaxSplit, leftOut: readonly SimplesTax[]): number {
  let total = 0;
  for (const tax of SIMPLES_TAXES) if (!leftOut.includes(tax)) total += percents[tax] ?? 0;
  return total;
}

export const hundredths = (percent: number) => Math.round(percent * 100 + 1e-9);

// The Simples percent (an export leaves out Cofins, PIS, ISS, ICMS, IPI) and the ISS in the DAS, or null.
export function simplesBreakdown(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: SimplesOptions,
): { percent: number; iss: number | null } {
  const { percents } = percentsOf(annex, rbt12Cents, options.band6Iss ?? 'outside');
  return {
    percent: percentWithout(percents, options.export ? EXPORT_LEAVES_OUT : []),
    iss: percents.iss ?? null,
  };
}

export interface SimplesShares {
  band: number;
  nominalRate: number;
  deductionCents: number;
  effectiveRate: number;
  // In hundredths; they add up to effectiveRate (art. 18 §1º-B II).
  taxes: TaxSplit;
  // The repartition of the table row; it adds up to 100%.
  shares: TaxSplit;
  // Unrounded percents: the PGDAS-D multiplies these by the revenue.
  effectivePercent: number;
  percents: TaxSplit;
  issCapped: boolean;
}

// The effective rate of the band and its split by tax.
export function simplesShares(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: { band6Iss?: Band6Iss } = {},
): SimplesShares {
  const { number, row, percents, issCapped } = percentsOf(
    annex,
    rbt12Cents,
    options.band6Iss ?? 'outside',
  );
  const effectivePercent = percentWithout(percents, []);
  const effectiveRate = hundredths(effectivePercent);
  const taxes: TaxSplit = {};
  let rounded = 0;
  for (const tax of SIMPLES_TAXES) {
    const percent = percents[tax];
    if (percent === undefined) continue;
    const value = hundredths(percent);
    taxes[tax] = value;
    rounded += value;
  }
  // LC 123, art. 18 §1º-B II: a difference of hundredths goes to the largest share of the band.
  const largest = SIMPLES_TAXES.reduce((best, tax) =>
    (row.share[tax] ?? 0) > (row.share[best] ?? 0) ? tax : best,
  );
  taxes[largest] = (taxes[largest] ?? 0) + effectiveRate - rounded;
  return {
    band: number,
    nominalRate: row.rate,
    deductionCents: row.deduction,
    effectiveRate,
    taxes,
    shares: { ...row.share },
    effectivePercent,
    percents,
    issCapped,
  };
}

// The retained ISS rate in hundredths (CGSN 140, art. 27): the effective ISS share of the band.
// Null when the DAS has no ISS: Anexos I and II, and band 6 once the ISS leaves the DAS.
export function simplesIssRate(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: { band6Iss?: Band6Iss } = {},
): number | null {
  const { iss } = simplesBreakdown(annex, rbt12Cents, { ...options, export: false });
  return iss === null ? null : hundredths(iss);
}

// The rate for pTotTribSN, in hundredths: the effective rate, without the shares an export leaves out.
export function simplesRate(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: SimplesOptions,
): number {
  return hundredths(simplesBreakdown(annex, rbt12Cents, options).percent);
}
