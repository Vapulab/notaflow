// Starting effective rate of each revenue band (LC 123/2006, Annexes III and V), in hundredths.
export const SIMPLES_BANDS: Record<'III' | 'V', number[]> = {
  III: [600, 1120, 1350, 1600, 2100, 3300],
  V: [1550, 1800, 1950, 2050, 2300, 3050],
};

export function percentText(hundredths: number): string {
  if (!Number.isInteger(hundredths) || hundredths < 0) {
    throw new RangeError(`A percentage must be a whole number of hundredths: ${hundredths}`);
  }
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}
