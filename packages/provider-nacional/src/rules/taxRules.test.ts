import { describe, expect, test } from 'vitest';
import { minimumIssRate, taxRules } from './taxRules';

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

describe('minimumIssRate', () => {
  test('is 2.00% for a service of the general list', () => {
    expect(minimumIssRate('010101')).toBe(200);
    expect(minimumIssRate('170101')).toBe(200);
  });

  test('is any rate above zero for subitems 7.02, 7.05, and 16.01 (LC 116, art. 8-A, paragraph 1)', () => {
    expect(minimumIssRate('070201')).toBe(1);
    expect(minimumIssRate('070502')).toBe(1);
    expect(minimumIssRate('160104')).toBe(1);
  });
});
