import { type Dispatcher, request } from 'undici';
import type { CnpjDraft } from './types';

export class LookupError extends Error {
  constructor(
    readonly code: 'cnpj_not_found' | 'cnpj_not_active' | 'cnpj_lookup_unavailable',
    // The registration status, when the company is not active.
    readonly status?: string,
  ) {
    super(code);
    this.name = 'LookupError';
  }
}

type Answer = { kind: 'ok'; body: unknown } | { kind: 'not_found' } | { kind: 'down' };

async function fetchJson(url: string, deps: LookupDeps): Promise<Answer> {
  try {
    const response = await request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'NotaFlow (+https://notaflow.vapulab.com)',
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
      ...(deps.dispatcher ? { dispatcher: deps.dispatcher } : {}),
    });
    if (response.statusCode === 200) return { kind: 'ok', body: await response.body.json() };
    await response.body.dump();
    return response.statusCode === 400 || response.statusCode === 404
      ? { kind: 'not_found' }
      : { kind: 'down' };
  } catch {
    // A timeout, a refused connection, or a body that is not JSON: try the other source.
    return { kind: 'down' };
  }
}

// opSimpNac of the national NFS-e: 1 not an optant, 2 MEI, 3 ME or EPP.
function simplesOption(simples: unknown, mei: unknown): '1' | '2' | '3' {
  if (mei === true) return '2';
  return simples === true ? '3' : '1';
}

const text = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);

function fromBrasilApi(cnpj: string, body: Record<string, unknown>) {
  return {
    status: String(body.descricao_situacao_cadastral ?? ''),
    draft: {
      cnpj,
      legalName: String(body.razao_social ?? ''),
      tradeName: text(body.nome_fantasia),
      municipality: String(body.codigo_municipio_ibge ?? ''),
      uf: String(body.uf ?? ''),
      cnae: text(body.cnae_fiscal),
      simplesNacional: simplesOption(body.opcao_pelo_simples, body.opcao_pelo_mei),
      source: 'brasilapi',
    } satisfies CnpjDraft,
  };
}

function fromCnpja(cnpj: string, body: Record<string, unknown>) {
  const company = (body.company ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const address = (body.address ?? {}) as Record<string, unknown>;
  const status = (body.status ?? {}) as Record<string, unknown>;
  const optant = (value: unknown) => (value as { optant?: unknown } | undefined)?.optant;
  return {
    status: String(status.text ?? ''),
    draft: {
      cnpj,
      legalName: String((company as { name?: unknown }).name ?? ''),
      tradeName: text(body.alias),
      municipality: String(address.municipality ?? ''),
      uf: String(address.state ?? ''),
      cnae: text((body.mainActivity as { id?: unknown } | undefined)?.id),
      simplesNacional: simplesOption(optant(company.simples), optant(company.simei)),
      source: 'cnpja',
    } satisfies CnpjDraft,
  };
}

export interface LookupDeps {
  dispatcher?: Dispatcher;
  timeoutMs?: number;
}

// BrasilAPI first; CNPJá open when BrasilAPI is down or limits us. Never a guess.
export async function lookupCnpj(cnpj: string, deps: LookupDeps = {}): Promise<CnpjDraft> {
  const brasil = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, deps);
  if (brasil.kind === 'not_found') throw new LookupError('cnpj_not_found');
  let found: { status: string; draft: CnpjDraft } | null =
    brasil.kind === 'ok' ? fromBrasilApi(cnpj, brasil.body as Record<string, unknown>) : null;
  // CNPJá when BrasilAPI is down or answers without the municipality.
  if (!found || !/^\d{7}$/.test(found.draft.municipality)) {
    const cnpja = await fetchJson(`https://open.cnpja.com/office/${cnpj}`, deps);
    if (cnpja.kind === 'not_found') throw new LookupError('cnpj_not_found');
    if (cnpja.kind === 'down') throw new LookupError('cnpj_lookup_unavailable');
    found = fromCnpja(cnpj, cnpja.body as Record<string, unknown>);
  }
  if (found.status.toUpperCase() !== 'ATIVA')
    throw new LookupError('cnpj_not_active', found.status);
  if (!/^\d{7}$/.test(found.draft.municipality)) throw new LookupError('cnpj_lookup_unavailable');
  return found.draft;
}
