import { expect, test } from 'vitest';
import { annexRule } from './annexRule';

test('the activities of LC 123, art. 18, §5º-I and §5º-M depend on the fator R', () => {
  expect(annexRule(['7112000'])).toBe('fator_r');
  expect(annexRule(['6201501', '4330404'])).toBe('fator_r');
  expect(annexRule(['8630504'])).toBe('fator_r');
});

test('works, cleaning, security, and law firms are Anexo IV (§5º-C)', () => {
  expect(annexRule(['4330404'])).toBe('IV');
  expect(annexRule(['4120400'])).toBe('IV');
  expect(annexRule(['8121400'])).toBe('IV');
  expect(annexRule(['8011101'])).toBe('IV');
  expect(annexRule(['6911701'])).toBe('IV');
});

test('the main activity decides; any other service is Anexo III', () => {
  expect(annexRule(['4330404', '7112000'])).toBe('IV');
  expect(annexRule(['6920601'])).toBe('III');
  expect(annexRule(['9602501'])).toBe('III');
});

test('no CNAE gives no answer', () => {
  expect(annexRule([])).toBeNull();
  expect(annexRule(null)).toBeNull();
});
