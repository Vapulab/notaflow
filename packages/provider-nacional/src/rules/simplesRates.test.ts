import { describe, expect, test } from 'vitest';
import { simplesBand, simplesRate } from './simplesRates';

const reais = (value: number) => Math.round(value * 100);

describe('simplesBand', () => {
  test.each([
    [0, 1],
    [180_000, 1],
    [180_000.01, 2],
    [360_000, 2],
    [720_000.01, 4],
    [4_800_000, 6],
  ])('RBT12 R$ %s is band %s', (rbt12, band) => {
    expect(simplesBand(reais(rbt12))).toBe(band);
  });

  test('above R$ 4.8 million is outside the Simples', () => {
    expect(simplesBand(reais(4_800_000.01))).toBeNull();
  });
});

describe('simplesRate (LC 123/2006, annexes III and V)', () => {
  test("Lincoln's export: Anexo III, RBT12 just above R$ 180 thousand, gives 3.12%", () => {
    // Effective 6.13%; an export leaves out ISS (32%), Cofins (14.05%), and PIS (3.05%).
    expect(simplesRate('III', reais(184_700), { export: true })).toBe(312);
  });

  test('band 1 is the nominal rate: 6.00% at home, 3.05% on an export', () => {
    expect(simplesRate('III', reais(120_000), { export: false })).toBe(600);
    expect(simplesRate('III', reais(120_000), { export: true })).toBe(305);
  });

  test('a new company with no revenue yet uses band 1', () => {
    expect(simplesRate('III', 0, { export: false })).toBe(600);
  });

  test('the effective rate follows (RBT12 x rate - deduction) / RBT12', () => {
    // (500,000 x 13.5% - 17,640) / 500,000 = 9.972%
    expect(simplesRate('III', reais(500_000), { export: false })).toBe(997);
    // (500,000 x 19.5% - 9,900) / 500,000 = 17.52%
    expect(simplesRate('V', reais(500_000), { export: false })).toBe(1752);
  });

  test('Anexo V on an export leaves out its own ISS, Cofins, and PIS shares', () => {
    // Band 1: 15.5% x (1 - 14% - 14.10% - 3.05%) = 10.67%
    expect(simplesRate('V', reais(100_000), { export: true })).toBe(1067);
  });

  test('Anexo III band 5 above 14.92537% caps the ISS at 5% before the export leaves it out', () => {
    // RBT12 3,500,000: effective (735,000 - 125,640) / 3,500,000 = 17.4103%.
    // Export: 17.4103 - 5 (ISS) - (17.4103 - 5) x (19.28% + 4.18%) = 9.4987%.
    expect(simplesRate('III', reais(3_500_000), { export: true })).toBe(950);
  });

  test('Anexo III band 6 has no ISS share: an export leaves out only Cofins and PIS', () => {
    // (4,000,000 x 33% - 648,000) / 4,000,000 = 16.8%; x (1 - 16.03% - 3.47%) = 13.524%
    expect(simplesRate('III', reais(4_000_000), { export: true })).toBe(1352);
  });

  test('outside the Simples there is no rate', () => {
    expect(() => simplesRate('III', reais(5_000_000), { export: false })).toThrow(RangeError);
  });
});
