import { readFileSync } from 'node:fs';

export interface Municipality {
  code: string; // IBGE, 7 digits
  name: string;
  uf: string;
}

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
}

// Anexo A v1.00 of 2025-12-10, sheets TAB.MUN_IBGE and TAB.PAÍS_ISO2: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_a-municipio_ibge-paises_iso2-v1-00-snnfse-20251210.xlsx
const load = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as T[];
const MUNICIPALITIES = load<Municipality>('./municipalities.json');
const COUNTRIES = load<Country>('./countries.json');

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const MUNICIPALITY_INDEX = MUNICIPALITIES.map((m) => ({
  entry: m,
  text: fold(`${m.name} ${m.uf}`),
}));
const COUNTRY_INDEX = COUNTRIES.map((c) => ({ entry: c, text: fold(`${c.name} ${c.code}`) }));
const BY_MUNICIPALITY = new Map(MUNICIPALITIES.map((m) => [m.code, m]));
const BY_COUNTRY = new Map(COUNTRIES.map((c) => [c.code, c]));

function search<T>(index: { entry: T; text: string }[], query: string, limit: number): T[] {
  const folded = fold(query).trim();
  const words = folded.split(/\s+/).filter(Boolean);
  const found = index.filter((i) => words.every((w) => i.text.includes(w)));
  const first = found.filter((i) => i.text.startsWith(folded));
  const rest = found.filter((i) => !i.text.startsWith(folded));
  return [...first, ...rest].slice(0, limit).map((i) => i.entry);
}

export function searchMunicipalities(query: string, limit = 20): Municipality[] {
  return search(MUNICIPALITY_INDEX, query, limit);
}

export function searchCountries(query: string, limit = 20): Country[] {
  return search(COUNTRY_INDEX, query, limit);
}

export function municipality(code: string): Municipality | null {
  return BY_MUNICIPALITY.get(code) ?? null;
}

export function country(code: string): Country | null {
  return BY_COUNTRY.get(code) ?? null;
}
