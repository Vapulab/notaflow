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

// Node only: not exported from the core index, because the web bundles that.
// Anexo A v1.00 of 2025-12-10, sheets TAB.MUN_IBGE and TAB.PAÍS_ISO2: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_a-municipio_ibge-paises_iso2-v1-00-snnfse-20251210.xlsx
const load = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as T[];

export const MUNICIPALITIES = load<Municipality>('./municipalities.json');
export const COUNTRIES = load<Country>('./countries.json');

const BY_MUNICIPALITY = new Map(MUNICIPALITIES.map((m) => [m.code, m]));
const BY_COUNTRY = new Map(COUNTRIES.map((c) => [c.code, c]));

export function municipalityByCode(code: string): Municipality | undefined {
  return BY_MUNICIPALITY.get(code);
}

export function countryByCode(code: string): Country | undefined {
  return BY_COUNTRY.get(code);
}
