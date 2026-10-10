import { expect, test } from 'vitest';
import { isCalendarDate, xsdDescription, xsdString } from './xmlText';

test('xsdString trims, makes typographic marks plain, and keeps Latin-1', () => {
  expect(xsdString('  Rua Teste ')).toBe('Rua Teste');
  expect(xsdString('D’Ávila – Centro')).toBe("D'Ávila - Centro");
  expect(xsdString('São João')).toBe('São João');
});

test('xsdString refuses blank text, characters outside Latin-1, and line breaks', () => {
  expect(xsdString('   ')).toBeNull();
  expect(xsdString('ul. Łódzka')).toBeNull();
  expect(xsdString('Rua\nTeste')).toBeNull();
});

test('xsdDescription keeps line breaks but refuses blank text and control characters', () => {
  expect(xsdDescription(' Linha 1\nLinha 2 ')).toBe('Linha 1\nLinha 2');
  expect(xsdDescription('   ')).toBeNull();
  expect(xsdDescription('a\u0001b')).toBeNull();
});

test('isCalendarDate accepts real dates only', () => {
  expect(isCalendarDate('2026-10-01')).toBe(true);
  expect(isCalendarDate('2028-02-29')).toBe(true);
  expect(isCalendarDate('2026-02-30')).toBe(false);
  expect(isCalendarDate('2026-13-01')).toBe(false);
  expect(isCalendarDate('01/10/2026')).toBe(false);
});
