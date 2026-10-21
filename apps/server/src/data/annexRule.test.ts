import { expect, test } from 'vitest';
import { fatorRApplies } from './annexRule';

test('the activities of LC 123, art. 18, §5º-I and §5º-M depend on the fator R', () => {
  expect(fatorRApplies(['7112000'])).toBe(true);
  expect(fatorRApplies(['6201501', '4330404'])).toBe(true);
  expect(fatorRApplies(['8630504'])).toBe(true);
});

test('the main activity decides, and a painter is never in the fator R', () => {
  expect(fatorRApplies(['4330404'])).toBe(false);
  expect(fatorRApplies(['4330404', '7112000'])).toBe(false);
  expect(fatorRApplies(['6920601'])).toBe(false);
});

test('no CNAE gives no answer', () => {
  expect(fatorRApplies([])).toBeNull();
  expect(fatorRApplies(null)).toBeNull();
});
