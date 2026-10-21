import { describe, expect, test } from 'vitest';
import { percentText } from './simplesBands';

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
