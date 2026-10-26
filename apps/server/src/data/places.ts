import {
  COUNTRIES,
  type Country,
  countryByCode,
  MUNICIPALITIES,
  type Municipality,
  municipalityByCode,
} from '@notaflow/core/places';

export type { Country, Municipality };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MUNICIPALITY_INDEX = MUNICIPALITIES.map((m) => ({
  entry: m,
  text: fold(`${m.name} ${m.uf}`),
}));
const COUNTRY_INDEX = COUNTRIES.map((c) => ({ entry: c, text: fold(`${c.name} ${c.code}`) }));

function search<T>(index: { entry: T; text: string }[], query: string, limit: number): T[] {
  const folded = fold(query).trim();
  const words = folded.split(/\s+/).filter(Boolean);
  const found = index.filter((i) => words.every((w) => i.text.includes(w)));
  const first = found.filter((i) => i.text.startsWith(folded));
  const rest = found.filter((i) => !i.text.startsWith(folded));
  return [...first, ...rest].slice(0, limit).map((i) => i.entry);
}

// An exact code answers that place alone; a saved address knows only its code.
export function searchMunicipalities(query: string, limit = 20): Municipality[] {
  const exact = municipality(query.trim());
  return exact ? [exact] : search(MUNICIPALITY_INDEX, query, limit);
}

export function searchCountries(query: string, limit = 20): Country[] {
  const exact = country(query.trim());
  return exact ? [exact] : search(COUNTRY_INDEX, query, limit);
}

export function municipality(code: string): Municipality | null {
  return municipalityByCode(code) ?? null;
}

export function country(code: string): Country | null {
  return countryByCode(code) ?? null;
}
