export function percentText(hundredths: number): string {
  if (!Number.isInteger(hundredths) || hundredths < 0) {
    throw new RangeError(`A percentage must be a whole number of hundredths: ${hundredths}`);
  }
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}
