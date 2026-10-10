import { describe, expect, test } from 'vitest';
import { percentText, SIMPLES_BANDS } from './simplesBands';

describe('SIMPLES_BANDS', () => {
  test('lists the effective starting rate of each band, in hundredths', () => {
    expect(SIMPLES_BANDS.III).toEqual([600, 1120, 1350, 1600, 2100, 3300]);
    expect(SIMPLES_BANDS.V).toEqual([1550, 1800, 1950, 2050, 2300, 3050]);
  });
});

describe('percentText', () => {
  test('writes hundredths as a percentage with two decimals', () => {
    expect(percentText(600)).toBe('6.00');
    expect(percentText(1120)).toBe('11.20');
    expect(percentText(5)).toBe('0.05');
  });

  test('refuses a negative or fractional value', () => {
    expect(() => percentText(-1)).toThrow(RangeError);
    expect(() => percentText(6.5)).toThrow(RangeError);
  });
});
