// @vitest-environment jsdom
import { expect, test } from 'vitest';
import {
  brasiliaToday,
  centsInput,
  fileToBase64,
  formatCents,
  formatCompetence,
  formatDate,
  formatDateTime,
  parseCents,
  previousMonthEnd,
} from './format';

test('formatCents writes BRL with comma decimals', () => {
  expect(formatCents(150000).replace(/\s/g, ' ')).toBe('R$ 1.500,00');
  expect(formatCents(5).replace(/\s/g, ' ')).toBe('R$ 0,05');
});

test('formatDate shows the Brasília day of a UTC timestamp', () => {
  expect(formatDate('2026-10-02T01:30:00.000Z')).toBe('01/10/2026');
  expect(formatDate('2026-10-02T03:30:00.000Z')).toBe('02/10/2026');
});

test('formatDate and formatCompetence use the Brazilian order', () => {
  expect(formatDate('2026-10-01T13:00:00.000Z')).toBe('01/10/2026');
  expect(formatDate(null)).toBe('');
  expect(formatCompetence('2026-09-30')).toBe('09/2026');
});

test('fileToBase64 reads a file without the data URL prefix', async () => {
  const file = new Blob([new Uint8Array([1, 2, 3, 250])]);
  expect(await fileToBase64(file)).toBe(Buffer.from([1, 2, 3, 250]).toString('base64'));
});

test('previousMonthEnd, parseCents, and centsInput', () => {
  expect(previousMonthEnd('2026-10-09')).toBe('2026-09-30');
  expect(previousMonthEnd('2026-03-01')).toBe('2026-02-28');
  expect(previousMonthEnd('2026-01-15')).toBe('2025-12-31');
  expect(parseCents('1.234,56')).toBe(123456);
  expect(parseCents('1234.56')).toBe(123456);
  expect(parseCents('12,5')).toBe(1250);
  expect(parseCents(' 10 ')).toBe(1000);
  expect(parseCents('abc')).toBeNull();
  expect(parseCents('1.2.3')).toBeNull();
  expect(centsInput(1086420)).toBe('10.864,20');
});

test('brasiliaToday is the Brasília date', () => {
  expect(brasiliaToday(new Date('2026-10-10T02:00:00Z'))).toBe('2026-10-09');
});

test('formatDateTime shows the Brasília date and time', () => {
  expect(formatDateTime('2026-10-10T14:11:24Z')).toBe('10/10/2026 11:11');
  expect(formatDateTime(null)).toBe('');
});
