import { type Dispatcher, request } from 'undici';
import { type Municipality, municipality } from '../data/places';

export interface CepAddress {
  zip: string;
  street: string;
  district: string;
  municipality: Municipality;
}

export class CepNotFoundError extends Error {}

// ViaCEP answers 200 with { erro: true } for an unknown CEP; its ibge field is the IBGE municipality code.
export async function fetchCep(options: {
  cep: string;
  dispatcher?: Dispatcher;
}): Promise<CepAddress> {
  const response = await request(`https://viacep.com.br/ws/${options.cep}/json/`, {
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.statusCode !== 200) {
    await response.body.dump();
    throw new Error(`ViaCEP answered ${response.statusCode}.`);
  }
  const body = (await response.body.json()) as {
    erro?: unknown;
    logradouro?: string;
    bairro?: string;
    ibge?: string;
  };
  const place = body.ibge ? municipality(body.ibge) : null;
  if (body.erro || !place) throw new CepNotFoundError(options.cep);
  return {
    zip: options.cep,
    street: body.logradouro ?? '',
    district: body.bairro ?? '',
    municipality: place,
  };
}
