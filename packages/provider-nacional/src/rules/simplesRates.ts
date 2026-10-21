// LC 123/2006, Anexos I to V (wording of LC 155/2016, in force since 2018), from the Planalto text.
// Rates and shares are in hundredths of a percent; the deduction and the band limits are in cents.
export const SIMPLES_ANNEXES = ['I', 'II', 'III', 'IV', 'V'] as const;
export type SimplesAnnex = (typeof SIMPLES_ANNEXES)[number];

// The shares an export leaves out (art. 18, §14); a tax outside the DAS has no share.
interface Share {
  cofins: number;
  pis: number;
  iss?: number;
  icms?: number;
  ipi?: number;
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

// Band 6 prints no ICMS or ISS share (art. 13-A); simplesBreakdown adds the ISS while it stays in the DAS.
const TABLES: Record<SimplesAnnex, Band[]> = {
  I: [
    band(0, 400, 0, { cofins: 1274, pis: 276, icms: 3400 }),
    band(1, 730, 5_940, { cofins: 1274, pis: 276, icms: 3400 }),
    band(2, 950, 13_860, { cofins: 1274, pis: 276, icms: 3350 }),
    band(3, 1070, 22_500, { cofins: 1274, pis: 276, icms: 3350 }),
    band(4, 1430, 87_300, { cofins: 1274, pis: 276, icms: 3350 }),
    band(5, 1900, 378_000, { cofins: 2827, pis: 613 }),
  ],
  II: [
    band(0, 450, 0, { cofins: 1151, pis: 249, ipi: 750, icms: 3200 }),
    band(1, 780, 5_940, { cofins: 1151, pis: 249, ipi: 750, icms: 3200 }),
    band(2, 1000, 13_860, { cofins: 1151, pis: 249, ipi: 750, icms: 3200 }),
    band(3, 1120, 22_500, { cofins: 1151, pis: 249, ipi: 750, icms: 3200 }),
    band(4, 1470, 85_500, { cofins: 1151, pis: 249, ipi: 750, icms: 3200 }),
    band(5, 3000, 720_000, { cofins: 2096, pis: 454, ipi: 3500 }),
  ],
  III: [
    band(0, 600, 0, { cofins: 1282, pis: 278, iss: 3350 }),
    band(1, 1120, 9_360, { cofins: 1405, pis: 305, iss: 3200 }),
    band(2, 1350, 17_640, { cofins: 1364, pis: 296, iss: 3250 }),
    band(3, 1600, 35_640, { cofins: 1364, pis: 296, iss: 3250 }),
    band(4, 2100, 125_640, { cofins: 1282, pis: 278, iss: 3350 }),
    band(5, 3300, 648_000, { cofins: 1603, pis: 347 }),
  ],
  // The CPP is paid outside the DAS (art. 18, §5º-C), so the shares add up to 100% without it.
  IV: [
    band(0, 450, 0, { cofins: 1767, pis: 383, iss: 4450 }),
    band(1, 900, 8_100, { cofins: 2055, pis: 445, iss: 4000 }),
    band(2, 1020, 12_420, { cofins: 1973, pis: 427, iss: 4000 }),
    band(3, 1400, 39_780, { cofins: 1890, pis: 410, iss: 4000 }),
    band(4, 2200, 183_780, { cofins: 1808, pis: 392, iss: 4000 }),
    band(5, 3300, 828_000, { cofins: 2055, pis: 445 }),
  ],
  V: [
    band(0, 1550, 0, { cofins: 1410, pis: 305, iss: 1400 }),
    band(1, 1800, 4_500, { cofins: 1410, pis: 305, iss: 1700 }),
    band(2, 1950, 9_900, { cofins: 1492, pis: 323, iss: 1900 }),
    band(3, 2050, 17_100, { cofins: 1574, pis: 341, iss: 2100 }),
    band(4, 2300, 62_100, { cofins: 1410, pis: 305, iss: 2350 }),
    band(5, 3050, 540_000, { cofins: 1644, pis: 356 }),
  ],
};

// Band 5 of Anexos III and IV: the ISS is at most 5%; above the threshold the rest is split like this.
// Anexo V prints no cap; its shares are the band 5 federal ones (14.10 / 76.50, 3.05 / 76.50), and
// its threshold is above the band 5 maximum (21.275%), so only band 6 with the ISS in the DAS uses it.
const BAND5_CAP: Partial<Record<SimplesAnnex, { threshold: number; cofins: number; pis: number }>> =
  {
    III: { threshold: 14.92537, cofins: 0.1928, pis: 0.0418 },
    IV: { threshold: 12.5, cofins: 0.3013, pis: 0.0654 },
    V: { threshold: 5 / 0.235, cofins: 0.1843, pis: 0.0399 },
  };
const ISS_CAP = 5;
const SUBLIMIT = 360_000_000;

// Where the ISS of a band 6 revenue goes (CGSN 140, art. 21 III b and art. 24 I; LC 123, art. 20 §1º).
// under_sublimit: this year's revenue is not above R$ 3.6 million, so the ISS stays in the DAS.
// over_sublimit: it is above, but the impediment does not take effect yet; the ISS stays in the DAS.
// outside: the impediment is in effect; the ISS goes to the municipality.
export const BAND6_ISS = ['under_sublimit', 'over_sublimit', 'outside'] as const;
export type Band6Iss = (typeof BAND6_ISS)[number];

export interface SimplesOptions {
  export: boolean;
  // Only band 6 reads it; without it, the ISS is outside the DAS.
  band6Iss?: Band6Iss;
}

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

const exportShare = ({ cofins, pis, iss = 0, icms = 0, ipi = 0 }: Share) =>
  (cofins + pis + iss + icms + ipi) / 10_000;

// The Simples percent of a revenue: the total, the ISS in the DAS (null without one), and the total
// on an export, which leaves out the Cofins, the PIS, the ISS, the ICMS, and the IPI.
export function simplesBreakdown(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: SimplesOptions,
): { percent: number; iss: number | null } {
  const number = simplesBand(rbt12Cents);
  const row = bandRow(annex, number);
  const effective = effectivePercent(row, rbt12Cents);
  const cap = BAND5_CAP[annex];
  const band5 = bandRow(annex, 5);
  const band6Iss = options.band6Iss ?? 'outside';
  if (number === 6 && band6Iss !== 'outside' && band5.share.iss !== undefined && cap) {
    // The band 5 formula on the RBT12, or on the sublimit for the revenue above it.
    const base = band6Iss === 'under_sublimit' ? rbt12Cents : SUBLIMIT;
    const fullIss = (effectivePercent(band5, base) * band5.share.iss) / 10_000;
    const iss = Math.min(fullIss, ISS_CAP);
    const excess = fullIss - iss;
    if (!options.export) return { percent: effective + fullIss, iss };
    const federal = effective * (1 - exportShare(row.share));
    return { percent: federal + excess * (1 - cap.cofins - cap.pis), iss };
  }
  const capped = number === 5 && cap !== undefined && effective > cap.threshold ? cap : null;
  const iss = row.share.iss === undefined ? null : (effective * row.share.iss) / 10_000;
  if (capped) {
    const rest = effective - ISS_CAP;
    return {
      percent: options.export ? rest - rest * (capped.cofins + capped.pis) : effective,
      iss: ISS_CAP,
    };
  }
  return { percent: options.export ? effective * (1 - exportShare(row.share)) : effective, iss };
}

// The retained ISS rate in hundredths (CGSN 140, art. 27): the effective ISS share of the band.
// Null when the DAS has no ISS: Anexos I and II, and band 6 once the ISS leaves the DAS.
export function simplesIssRate(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: { band6Iss?: Band6Iss } = {},
): number | null {
  const { iss } = simplesBreakdown(annex, rbt12Cents, { ...options, export: false });
  return iss === null ? null : Math.round(iss * 100 + 1e-9);
}

// The rate for pTotTribSN, in hundredths: the effective rate, without the shares an export leaves out.
export function simplesRate(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: SimplesOptions,
): number {
  return Math.round(simplesBreakdown(annex, rbt12Cents, options).percent * 100 + 1e-9);
}
