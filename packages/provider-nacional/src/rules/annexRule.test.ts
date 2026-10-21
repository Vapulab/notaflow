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

test('dental prosthesis, agronomy, and journalism depend on the fator R', () => {
  // §5º-B XX and §5º-D XIV: prótese dentária.
  expect(annexRule(['3250706'])).toBe('fator_r');
  // §5º-I VI: agronomia.
  expect(annexRule(['7490103'])).toBe('fator_r');
  // §5º-I X: jornalismo (news agencies, and independent journalists and writers).
  expect(annexRule(['6391700'])).toBe('fator_r');
  expect(annexRule(['9002701'])).toBe('fator_r');
});

test('§5º-I XII: the other professional, scientific, and technical services depend on the fator R', () => {
  expect(annexRule(['7119701'])).toBe('fator_r');
  expect(annexRule(['7319002'])).toBe('fator_r');
  expect(annexRule(['7490105'])).toBe('fator_r');
  expect(annexRule(['7490199'])).toBe('fator_r');
  // Interior decoration stays in Anexo IV (§5º-C I).
  expect(annexRule(['7410202'])).toBe('IV');
});

test('§5º-I XII leaves out the services that are not intellectual, and those of other annexes', () => {
  // Diving and photography are not intellectual services.
  expect(annexRule(['7490102'])).toBe('III');
  expect(annexRule(['7420001'])).toBe('III');
  // §5º-B I and XV: education and artistic productions are Anexo III.
  expect(annexRule(['8599604'])).toBe('III');
  expect(annexRule(['9001901'])).toBe('III');
});
