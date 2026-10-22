import { useEffect, useState } from 'react';
import { api, type Band6Iss, type SimplesAnnex } from '../api';
import { percentInput } from '../format';

export interface SimplesRates {
  band: number;
  domestic: number; // hundredths
  export: number; // hundredths
  iss: number | null; // hundredths; null where the ISS goes outside the DAS
}

export const RBT12_LABEL = 'Receita bruta dos últimos 12 meses (R$)';

export const ANNEX_OPTIONS: [SimplesAnnex, string][] = [
  ['I', 'Anexo I (comércio)'],
  ['II', 'Anexo II (indústria)'],
  ['III', 'Anexo III (serviços)'],
  ['IV', 'Anexo IV (obras, limpeza, vigilância, advocacia)'],
  ['V', 'Anexo V (serviços com fator R)'],
];

export function isSimplesAnnex(value: string): value is SimplesAnnex {
  return ANNEX_OPTIONS.some(([annex]) => annex === value);
}

// The Simples Nacional bands, by gross revenue of the last 12 months (LC 123/2006), in cents.
const BAND_LIMITS = [18_000_000, 36_000_000, 72_000_000, 180_000_000, 360_000_000, 480_000_000];

export function simplesBand(revenueCents: number | null): number | null {
  if (revenueCents === null) return null;
  const index = BAND_LIMITS.findIndex((limit) => revenueCents <= limit);
  return index === -1 ? null : index + 1;
}

export { isBand6Iss } from './band6IssText';

// Anexos I and II have no ISS in the DAS, so only Anexos III, IV, and V ask in band 6.
export function asksBand6Iss(annex: SimplesAnnex | null, band: number | null): boolean {
  return band === 6 && annex !== null && annex !== 'I' && annex !== 'II';
}

// The DAS of Anexos I and II has no ISS share, so the ISS of a service uses the municipal rate.
export function issOutsideDas(
  annex: SimplesAnnex | null,
  band: number | null,
  band6Iss: Band6Iss | null,
): boolean {
  return annex === 'I' || annex === 'II' || (band === 6 && band6Iss === 'outside');
}

export function ratesLine(rates: SimplesRates): string {
  const iss = rates.iss === null ? 'ISS fora do DAS' : `ISS retido ${percentInput(rates.iss)}%`;
  return `Faixa ${rates.band} · alíquota efetiva ${percentInput(rates.domestic)}% · exportação ${percentInput(rates.export)}% · ${iss}`;
}

// The rate of a month comes from the 12 months before it, so a revenue informed before this month is old.
export function revenueIsStale(informedAt: string | null, today = new Date()): boolean {
  if (!informedAt) return false;
  const at = new Date(informedAt);
  return at.getFullYear() * 12 + at.getMonth() < today.getFullYear() * 12 + today.getMonth();
}

// The server's calculation for a revenue the user is typing; null until it answers.
export function useSimplesRates(
  url: string,
  annex: SimplesAnnex,
  rbt12Cents: number | null,
  band6Iss: Band6Iss | null = null,
): { rates: SimplesRates | null; error: unknown } {
  const [state, setState] = useState<{ rates: SimplesRates | null; error: unknown }>({
    rates: null,
    error: null,
  });
  useEffect(() => {
    if (rbt12Cents === null) {
      setState({ rates: null, error: null });
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      const band6 = band6Iss ? `&band6Iss=${band6Iss}` : '';
      api.get<SimplesRates>(`${url}?annex=${annex}&rbt12Cents=${rbt12Cents}${band6}`).then(
        (rates) => live && setState({ rates, error: null }),
        (error: unknown) => live && setState({ rates: null, error }),
      );
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [url, annex, rbt12Cents, band6Iss]);
  return state;
}
