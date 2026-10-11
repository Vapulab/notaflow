import { readFileSync } from 'node:fs';

export interface ServiceCode {
  code: string; // cTribNac, 6 digits
  description: string;
}

// Anexo B v1.01 of 2026-01-22, sheet LISTA.SERV.NAC.: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx
const CODES = JSON.parse(
  readFileSync(new URL('./serviceCodes.json', import.meta.url), 'utf8'),
) as ServiceCode[];

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const INDEX = CODES.map((c) => ({ entry: c, text: fold(c.description) }));

export function searchServiceCodes(query: string, limit = 20): ServiceCode[] {
  const digits = query.replace(/[.\s]/g, '');
  if (/^\d+$/.test(digits)) {
    return CODES.filter((c) => c.code.startsWith(digits)).slice(0, limit);
  }
  const words = fold(query).split(/\s+/).filter(Boolean);
  return INDEX.filter((i) => words.every((w) => i.text.includes(w)))
    .slice(0, limit)
    .map((i) => i.entry);
}

export function serviceCode(code: string): ServiceCode | null {
  return CODES.find((c) => c.code === code) ?? null;
}

// The codes of LC 116 item groups (the first two digits), group by group in the order given.
export function codesInGroups(groups: string[]): ServiceCode[] {
  return groups.flatMap((group) => CODES.filter((c) => c.code.startsWith(group)));
}
