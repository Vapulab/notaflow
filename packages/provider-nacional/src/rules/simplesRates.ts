// LC 123/2006, Anexos III and V (wording of LC 155/2016, in force since 2018), from the Planalto text.
// Rates and shares are in hundredths of a percent; the deduction and the band limits are in cents.
export type SimplesAnnex = 'III' | 'V';

interface Band {
  upTo: number;
  rate: number;
  deduction: number;
  // Shares of the effective rate by tax; the export leaves out ISS, Cofins, and PIS.
  share: { cofins: number; pis: number; iss: number };
}

const LIMITS = [18_000_000, 36_000_000, 72_000_000, 180_000_000, 360_000_000, 480_000_000];

const band = (index: number, rate: number, deductionReais: number, share: Band['share']) => {
  const upTo = LIMITS[index];
  if (upTo === undefined) throw new RangeError(`No band ${index + 1}`);
  return { upTo, rate, deduction: deductionReais * 100, share };
};

const TABLES: Record<SimplesAnnex, Band[]> = {
  III: [
    band(0, 600, 0, { cofins: 1282, pis: 278, iss: 3350 }),
    band(1, 1120, 9_360, { cofins: 1405, pis: 305, iss: 3200 }),
    band(2, 1350, 17_640, { cofins: 1364, pis: 296, iss: 3250 }),
    band(3, 1600, 35_640, { cofins: 1364, pis: 296, iss: 3250 }),
    band(4, 2100, 125_640, { cofins: 1282, pis: 278, iss: 3350 }),
    band(5, 3300, 648_000, { cofins: 1603, pis: 347, iss: 0 }),
  ],
  V: [
    band(0, 1550, 0, { cofins: 1410, pis: 305, iss: 1400 }),
    band(1, 1800, 4_500, { cofins: 1410, pis: 305, iss: 1700 }),
    band(2, 1950, 9_900, { cofins: 1492, pis: 323, iss: 1900 }),
    band(3, 2050, 17_100, { cofins: 1574, pis: 341, iss: 2100 }),
    band(4, 2300, 62_100, { cofins: 1410, pis: 305, iss: 2350 }),
    band(5, 3050, 540_000, { cofins: 1644, pis: 356, iss: 0 }),
  ],
};

// Anexo III, band 5: the ISS is at most 5%; above an effective 14.92537% the rest is split like this.
const III_BAND5_CAP = { iss: 5, cofins: 0.1928, pis: 0.0418, threshold: 14.92537 };

// The band of a gross revenue of the last 12 months (RBT12), or null above the Simples limit.
export function simplesBand(rbt12Cents: number): number | null {
  const index = LIMITS.findIndex((limit) => rbt12Cents <= limit);
  return index === -1 ? null : index + 1;
}

// The rate for pTotTribSN, in hundredths: the effective rate, without ISS, Cofins, and PIS on an export.
export function simplesRate(
  annex: SimplesAnnex,
  rbt12Cents: number,
  options: { export: boolean },
): number {
  const number = simplesBand(rbt12Cents);
  const row = number === null ? undefined : TABLES[annex][number - 1];
  if (!row)
    throw new RangeError('A revenue above R$ 4,800,000.00 is outside the Simples Nacional.');
  // A company with no revenue yet pays the nominal rate of band 1.
  const effective =
    rbt12Cents === 0
      ? row.rate / 100
      : (((rbt12Cents * row.rate) / 10_000 - row.deduction) / rbt12Cents) * 100;
  let percent = effective;
  if (options.export) {
    if (annex === 'III' && number === 5 && effective > III_BAND5_CAP.threshold) {
      const rest = effective - III_BAND5_CAP.iss;
      percent = rest - rest * (III_BAND5_CAP.cofins + III_BAND5_CAP.pis);
    } else {
      const { cofins, pis, iss } = row.share;
      percent = effective * (1 - (cofins + pis + iss) / 10_000);
    }
  }
  return Math.round(percent * 100 + 1e-9);
}
