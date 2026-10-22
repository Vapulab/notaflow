// The month of the PGDAS-D: the RBT12, the Fator R, and the DAS of each revenue line.
import {
  type Band6Iss,
  EXPORT_LEAVES_OUT,
  hundredths,
  percentWithout,
  SIMPLES_TAXES,
  type SimplesAnnex,
  simplesBand,
  simplesIssRate,
  simplesShares,
  type SimplesTax,
  type TaxSplit,
} from './simplesRates';

export type RevenueKind = 'normal' | 'iss_retained' | 'export';

const LEAVES_OUT: Record<RevenueKind, readonly SimplesTax[]> = {
  normal: [],
  // CGSN 140, art. 25 §9º II: only the ISS share leaves; the federal shares stay.
  iss_retained: ['iss'],
  export: EXPORT_LEAVES_OUT,
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function monthIndex(month: string): number {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError(`Not a YYYY-MM month: ${month}`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export const monthName = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

export const addMonths = (month: string, count: number) => monthName(monthIndex(month) + count);

// CGSN 140 art. 22; a missing month counts as zero; it also annualizes the Fator R payroll (art. 26 §4º).
export function rbt12Window(input: {
  month: string;
  activityStart: string;
  revenues: Record<string, number>;
}): { rbt12Cents: number; rule: 'full' | 'first_month' | 'proportional'; months: string[] } {
  const current = monthIndex(input.month);
  const active = current - monthIndex(input.activityStart);
  if (active < 0) throw new RangeError('The month is before the start of activity.');
  const revenueOf = (index: number) => input.revenues[monthName(index)] ?? 0;
  if (active === 0)
    return { rbt12Cents: revenueOf(current) * 12, rule: 'first_month', months: [input.month] };
  const count = Math.min(active, 12);
  const indexes = Array.from({ length: count }, (_, i) => current - count + i);
  const months = indexes.map(monthName);
  const total = indexes.reduce((sum, index) => sum + revenueOf(index), 0);
  if (active >= 12) return { rbt12Cents: total, rule: 'full', months };
  return { rbt12Cents: Math.round((total * 12) / count), rule: 'proportional', months };
}

// The rbt12Cents adds both markets (CGSN 140 art. 26 §5º V).
export function fatorR(input: {
  payroll: { salaries: number; proLabore: number; fgts: number; cpp: number; other: number };
  rbt12Cents: number;
}): { ratioHundredths: number; annex: 'III' | 'V' } {
  const { salaries, proLabore, fgts, cpp, other } = input.payroll;
  const payrollCents = salaries + proLabore + fgts + cpp + other;
  // CGSN 140 art. 26 §6º and §7º; the PGDAS-D truncates r to two decimals (manual 8.2.1).
  const ratio =
    payrollCents === 0
      ? 1
      : input.rbt12Cents === 0
        ? 28
        : Math.floor((payrollCents * 100) / input.rbt12Cents);
  return { ratioHundredths: ratio, annex: ratio >= 28 ? 'III' : 'V' };
}

// CGSN 140 art. 27: the RBT12 of the month before the service, or the fixed 2% and 5% cases.
export type RetainedIss = { rbt12Cents: number } | 'first_month' | 'not_on_invoice';

export interface SimplesMonthLine {
  annex: SimplesAnnex;
  kind: RevenueKind;
  revenueCents: number;
  rate: number;
  dasCents: number;
  taxes: TaxSplit;
  // What the customer retains, outside the DAS; null without the input or without a Simples ISS.
  retainedIss: { rate: number; cents: number } | null;
}

export interface SimplesMonth {
  lines: SimplesMonthLine[];
  totalCents: number;
  warnings: ('band6' | 'iss_cap')[];
}

function retainedIssRate(
  annex: SimplesAnnex,
  retained: RetainedIss,
  options: { band6Iss?: Band6Iss },
): number | null {
  if (retained === 'first_month') return 200;
  if (retained === 'not_on_invoice') return 500;
  return simplesIssRate(annex, retained.rbt12Cents, options);
}

// rbt12Cents is the domestic market; an export line uses exportRbt12Cents (CGSN 140 art. 23).
export function simplesMonth(input: {
  rbt12Cents: number;
  exportRbt12Cents?: number;
  band6Iss?: Band6Iss;
  lines: {
    annex: SimplesAnnex;
    kind: RevenueKind;
    revenueCents: number;
    band6Iss?: Band6Iss;
    retainedIss?: RetainedIss;
  }[];
}): SimplesMonth {
  const band = simplesBand(input.rbt12Cents);
  if (band === null)
    throw new RangeError('A revenue above R$ 4,800,000.00 is outside the Simples Nacional.');
  let issCap = false;
  const lines = input.lines.map((line): SimplesMonthLine => {
    const rbt12Cents = line.kind === 'export' ? input.exportRbt12Cents : input.rbt12Cents;
    if (rbt12Cents === undefined)
      throw new RangeError('An export line needs the RBT12 of the exports (CGSN 140, art. 23).');
    const band6Iss = line.band6Iss ?? input.band6Iss;
    const options = band6Iss ? { band6Iss } : {};
    const shares = simplesShares(line.annex, rbt12Cents, options);
    issCap ||= shares.issCapped;
    const leftOut = LEAVES_OUT[line.kind];
    const taxes: TaxSplit = {};
    let dasCents = 0;
    // The PGDAS-D rounds each tax to the cent, and the DAS is their sum (manual, section 12).
    for (const tax of SIMPLES_TAXES) {
      const percent = shares.percents[tax];
      if (percent === undefined || leftOut.includes(tax)) continue;
      const cents = Math.round((line.revenueCents * percent) / 100 + 1e-6);
      taxes[tax] = cents;
      dasCents += cents;
    }
    // No ISS in this month's DAS (Anexos I and II, band 6 outside): no Simples rate to retain.
    const retainedRate =
      line.kind === 'iss_retained' && line.retainedIss && shares.percents.iss !== undefined
        ? retainedIssRate(line.annex, line.retainedIss, options)
        : null;
    return {
      annex: line.annex,
      kind: line.kind,
      revenueCents: line.revenueCents,
      rate: hundredths(percentWithout(shares.percents, leftOut)),
      dasCents,
      taxes,
      retainedIss:
        retainedRate === null
          ? null
          : { rate: retainedRate, cents: Math.round((line.revenueCents * retainedRate) / 10_000) },
    };
  });
  const warnings: SimplesMonth['warnings'] = [];
  // Band 6 starts above the R$ 3.6 million sublimit: the band 6 answer decides the ISS.
  if (band === 6) warnings.push('band6');
  if (issCap) warnings.push('iss_cap');
  return { lines, totalCents: lines.reduce((sum, line) => sum + line.dasCents, 0), warnings };
}
