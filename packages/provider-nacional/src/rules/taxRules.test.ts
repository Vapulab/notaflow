import { describe, expect, test } from 'vitest';
import { taxRules } from './taxRules';

describe('taxRules', () => {
  test('in 2026 a Brazil customer is taxable in the municipality and may use the ISS rate', () => {
    expect(taxRules('2026-10-31').forCustomer(false)).toEqual({
      issqnTaxation: '1',
      usesIssRate: true,
      foreignTrade: false,
    });
  });

  test('in 2026 a customer abroad is an export with foreign trade and no ISS rate', () => {
    expect(taxRules('2026-12-31').forCustomer(true)).toEqual({
      issqnTaxation: '3',
      usesIssRate: false,
      foreignTrade: true,
    });
  });

  test('a 2027 competence is refused until the 2027 rules exist', () => {
    expect(() => taxRules('2027-01-01')).toThrow(/2027/);
  });

  test('a competence that is not a date is refused', () => {
    expect(() => taxRules('31/10/2026')).toThrow(RangeError);
  });
});
