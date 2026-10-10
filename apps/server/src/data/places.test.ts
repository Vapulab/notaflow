import { expect, test } from 'vitest';
import { country, municipality, searchCountries, searchMunicipalities } from './places';

test('the tables hold the 5570 IBGE municipalities and 250 countries', () => {
  expect(searchMunicipalities('', 10_000)).toHaveLength(5570);
  expect(searchCountries('', 1000)).toHaveLength(250);
});

test('a municipality is found by its IBGE code, with its state', () => {
  expect(municipality('4113700')).toEqual({ code: '4113700', name: 'Londrina', uf: 'PR' });
  expect(municipality('4113701')).toBeNull();
});

test('a municipality search ignores case and accents, and takes the state too', () => {
  expect(searchMunicipalities('sao paulo sp').map((m) => m.code)).toEqual(['3550308']);
  expect(searchMunicipalities('LONDRINA')[0]?.code).toBe('4113700');
  expect(searchMunicipalities('a').length).toBe(20);
  // A name that starts with the query comes before one that only contains it.
  expect(searchMunicipalities('londrina').map((m) => m.name)).toEqual([
    'Londrina',
    'Nova Londrina',
  ]);
});

test('a country is found by its ISO code or its name', () => {
  expect(country('US')?.code).toBe('US');
  expect(country('XX')).toBeNull();
  expect(searchCountries('estados unidos').map((c) => c.code)).toContain('US');
});

test('a search by an exact code answers that place, so a saved address shows its name', () => {
  expect(searchMunicipalities('4113700')).toEqual([
    { code: '4113700', name: 'Londrina', uf: 'PR' },
  ]);
  expect(searchCountries('US')[0]?.code).toBe('US');
});
