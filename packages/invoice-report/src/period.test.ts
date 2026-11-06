import { describe, expect, it } from 'vitest';
import { monthPeriod, periodLabel, periodSlug, PeriodError, rangePeriod, spansMonths, yearPeriod } from './period';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof PeriodError ? error.code : undefined;
  }
  return undefined;
}

describe('period', () => {
  it('builds a month period', () => {
    expect(monthPeriod('2026-02')).toEqual({ type: 'month', from: '2026-02-01', to: '2026-02-28' });
    expect(monthPeriod('2028-02').to).toBe('2028-02-29');
  });

  it('builds a year period', () => {
    expect(yearPeriod(2026)).toEqual({ type: 'year', from: '2026-01-01', to: '2026-12-31' });
  });

  it('validates a range', () => {
    expect(codeOf(() => rangePeriod('2026-09-30', '2026-07-01'))).toBe('period_invalid');
    expect(codeOf(() => rangePeriod('2025-01-01', '2026-01-03'))).toBe('period_too_long');
    expect(rangePeriod('2024-01-01', '2024-12-31').type).toBe('range');
  });

  it('rejects malformed input', () => {
    expect(codeOf(() => monthPeriod('2026-13'))).toBe('period_invalid');
    expect(codeOf(() => rangePeriod('2026-02-30', '2026-03-01'))).toBe('period_invalid');
  });

  it('labels and slugs each type', () => {
    expect(periodLabel(monthPeriod('2026-10'))).toBe('Outubro de 2026');
    expect(periodLabel(yearPeriod(2026))).toBe('2026');
    const range = rangePeriod('2026-07-01', '2026-09-30');
    expect(periodLabel(range)).toBe('01/07/2026 a 30/09/2026');
    expect(periodSlug(monthPeriod('2026-10'))).toBe('2026-10');
    expect(periodSlug(yearPeriod(2026))).toBe('2026');
    expect(periodSlug(range)).toBe('2026-07-01_2026-09-30');
  });

  it('tells whether a period spans months', () => {
    expect(spansMonths(monthPeriod('2026-10'))).toBe(false);
    expect(spansMonths(yearPeriod(2026))).toBe(true);
  });
});
