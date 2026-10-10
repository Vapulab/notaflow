import { type Dispatcher, request } from 'undici';

export const BACEN_CURRENCY: Record<string, string> = { '220': 'USD', '978': 'EUR' };

export interface PtaxRate {
  currency: string;
  date: string;
  rateE4: number;
  source: 'PTAX venda, fechamento';
}

const BASE =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)';

export async function fetchPtaxSell(options: {
  currency: string;
  date: string;
  dispatcher?: Dispatcher;
  maxDaysBack?: number;
}): Promise<PtaxRate> {
  const day = new Date(`${options.date}T12:00:00Z`);
  for (let back = 0; back <= (options.maxDaysBack ?? 10); back++) {
    const iso = day.toISOString().slice(0, 10);
    const [year, month, date] = iso.split('-');
    const url = `${BASE}?@moeda=%27${options.currency}%27&@dataCotacao=%27${month}-${date}-${year}%27&%24format=json`;
    const response = await request(url, {
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.statusCode !== 200) {
      await response.body.dump();
      throw new Error(`The PTAX service answered ${response.statusCode}.`);
    }
    const body = (await response.body.json()) as {
      value?: { tipoBoletim: string; cotacaoVenda: number }[];
    };
    const closing = body.value?.find((bulletin) => bulletin.tipoBoletim === 'Fechamento PTAX');
    if (closing) {
      return {
        currency: options.currency,
        date: iso,
        rateE4: Math.round(closing.cotacaoVenda * 10_000),
        source: 'PTAX venda, fechamento',
      };
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  throw new Error(`No PTAX closing rate for ${options.currency} up to ${options.date}.`);
}

export type ExchangeRateSource = (currency: string, date: string) => Promise<PtaxRate>;

export function ptaxSource(dispatcher?: Dispatcher): ExchangeRateSource {
  return (currency, date) =>
    fetchPtaxSell({ currency, date, ...(dispatcher ? { dispatcher } : {}) });
}

export function convertToCents(foreignCents: number, rateE4: number): number {
  // Integer math: cents times the rate scaled by 10 000, rounded half away from zero.
  return Math.round((foreignCents * rateE4) / 10_000);
}
