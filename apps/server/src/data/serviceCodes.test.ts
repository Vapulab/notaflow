import { expect, test } from 'vitest';
import { searchServiceCodes, serviceCode } from './serviceCodes';

test('the table holds the 338 six-digit national codes, each once', () => {
  const all = searchServiceCodes('', 1000);
  expect(all).toHaveLength(338);
  expect(new Set(all.map((c) => c.code)).size).toBe(338);
  expect(all.every((c) => /^\d{6}$/.test(c.code) && c.description.length > 0)).toBe(true);
});

test('a search ignores case and accents and returns code and description', () => {
  const found = searchServiceCodes('INFORMATICA');
  expect(found.map((c) => c.code)).toEqual(['010601', '010701']);
  expect(found[0]).toEqual({
    code: '010601',
    description: 'Assessoria e consultoria em informática.',
  });
});

test('every word of the query must match', () => {
  expect(searchServiceCodes('consultoria informatica').map((c) => c.code)).toEqual(['010601']);
});

test('a code prefix finds the codes, with or without dots', () => {
  expect(searchServiceCodes('01.07').map((c) => c.code)).toEqual(['010701']);
  expect(searchServiceCodes('0107').map((c) => c.code)).toEqual(['010701']);
});

test('a search returns at most 20 codes', () => {
  expect(searchServiceCodes('servicos').length).toBe(20);
});

test('serviceCode finds one code or nothing', () => {
  expect(serviceCode('010701')?.description).toMatch(/^Suporte técnico/);
  expect(serviceCode('999999')).toBeNull();
});
