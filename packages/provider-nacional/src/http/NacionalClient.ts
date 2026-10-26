import { type Dispatcher, request } from 'undici';
import type { Environment } from '../dps/types';
import { ENDPOINTS } from './endpoints';
import { gunzipBase64, gzipBase64 } from './gzipBase64';

export interface SefinError {
  codigo: string;
  descricao: string;
  complemento?: string;
}

export type IssueResult =
  | { kind: 'issued'; accessKey: string; dpsId: string; nfseXml: string; alerts: SefinError[] }
  | { kind: 'rejected'; dpsId: string; errors: SefinError[] }
  | { kind: 'uncertain'; reason: string; accessKey?: string };

export type DpsLookup = { kind: 'found'; accessKey: string } | { kind: 'not_found' };

export type EventResult =
  { kind: 'registered'; eventXml: string | null } | { kind: 'rejected'; error: SefinError };

export interface DfeDocument {
  nsu: number;
  accessKey: string;
  type: string;
  eventType?: string;
  xml: string;
  createdAt: string;
}

export interface DfeBatch {
  status: 'DOCUMENTOS_LOCALIZADOS' | 'NENHUM_DOCUMENTO_LOCALIZADO' | 'REJEICAO';
  documents: DfeDocument[];
  errors: unknown[];
}

export class NacionalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly body: unknown,
  ) {
    super(`Unexpected HTTP ${status} from the national NFS-e API`);
    this.name = 'NacionalHttpError';
  }
}

interface RawDfeItem {
  NSU: number;
  ChaveAcesso: string;
  TipoDocumento: string;
  TipoEvento?: string;
  ArquivoXml: string;
  DataHoraGeracao: string;
}

type Json = Record<string, unknown>;

function tryGunzip(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return gunzipBase64(value);
  } catch {
    return null;
  }
}

// The Sefin refuses XML without a declaration with E1229 "Xml não está utilizando codificação UTF-8".
function withDeclaration(xml: string): string {
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>${xml}`;
}

// The Sefin sends Codigo and Descricao capitalized, unlike its published examples.
function sefinError(raw: unknown): SefinError {
  const r = (raw ?? {}) as Json;
  const complemento = r.complemento ?? r.Complemento;
  return {
    codigo: String(r.codigo ?? r.Codigo ?? ''),
    descricao: String(r.descricao ?? r.Descricao ?? ''),
    ...(typeof complemento === 'string' ? { complemento } : {}),
  };
}

// E0014: an NFS-e already exists for this DPS (RFC Open Questions).
export function isDuplicateDps(errors: SefinError[]): boolean {
  return errors.some((error) => error.codigo === 'E0014');
}

// Some Sefin error bodies arrive in Latin-1 (seen with E0014), so invalid UTF-8 falls back to it.
function decodeBody(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

function httpError(status: number, body: unknown): NacionalHttpError {
  return new NacionalHttpError(status, status >= 500 || status === 429, body);
}

export class NacionalClient {
  private readonly urls: { sefin: string; adn: string };
  private readonly dispatcher: Dispatcher;
  private readonly timeoutMs: number;

  constructor(options: {
    environment: Environment;
    dispatcher: Dispatcher;
    timeoutMs?: number;
    // Points the client at the local fake (packages/fake-nacional) instead of gov.br.
    urls?: { sefin: string; adn: string };
  }) {
    this.urls = options.urls ?? ENDPOINTS[options.environment];
    this.dispatcher = options.dispatcher;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async issue(signedDpsXml: string): Promise<IssueResult> {
    let response: { status: number; body: unknown };
    try {
      response = await this.call('POST', `${this.urls.sefin}/nfse`, {
        dpsXmlGZipB64: gzipBase64(withDeclaration(signedDpsXml)),
      });
    } catch (error) {
      return { kind: 'uncertain', reason: error instanceof Error ? error.message : String(error) };
    }
    const body = (response.body ?? {}) as Json;
    if (response.status === 201) {
      // A 201 we cannot read may still be a real invoice, so it is uncertain, never an error.
      if (typeof body.chaveAcesso !== 'string') {
        return { kind: 'uncertain', reason: 'HTTP 201 without an access key' };
      }
      const nfseXml = tryGunzip(body.nfseXmlGZipB64);
      if (nfseXml === null) {
        return {
          kind: 'uncertain',
          reason: 'HTTP 201 without a readable NFS-e XML',
          accessKey: body.chaveAcesso,
        };
      }
      return {
        kind: 'issued',
        accessKey: body.chaveAcesso,
        dpsId: String(body.idDps),
        nfseXml,
        alerts: (body.alertas as SefinError[] | undefined) ?? [],
      };
    }
    if (response.status === 400) {
      // The success body says idDps; the error body says idDPS.
      return {
        kind: 'rejected',
        dpsId: String(body.idDPS ?? body.idDps ?? ''),
        errors: Array.isArray(body.erros) ? body.erros.map(sefinError) : [],
      };
    }
    return { kind: 'uncertain', reason: `HTTP ${response.status}` };
  }

  async findByDpsId(dpsId: string): Promise<DpsLookup> {
    const { status, body } = await this.call(
      'GET',
      `${this.urls.sefin}/dps/${encodeURIComponent(dpsId)}`,
    );
    if (status === 200) return { kind: 'found', accessKey: String((body as Json).chaveAcesso) };
    // A proxy or gateway 404 is not an answer about the DPS, so only a JSON body means not found.
    if (status === 404) {
      if (typeof body === 'object' && body !== null && !Array.isArray(body))
        return { kind: 'not_found' };
      throw new NacionalHttpError(status, true, body);
    }
    throw httpError(status, body);
  }

  async getNfse(accessKey: string): Promise<string> {
    const { status, body } = await this.call(
      'GET',
      `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}`,
    );
    if (status !== 200) throw httpError(status, body);
    return gunzipBase64(String((body as Json).nfseXmlGZipB64));
  }

  async registerEvent(accessKey: string, signedEventXml: string): Promise<EventResult> {
    const url = `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}/eventos`;
    const { status, body } = await this.call('POST', url, {
      pedidoRegistroEventoXmlGZipB64: gzipBase64(withDeclaration(signedEventXml)),
    });
    const data = (body ?? {}) as Json;
    // The event exists once the Sefin answers 201, even when its XML is unreadable.
    if (status === 201) return { kind: 'registered', eventXml: tryGunzip(data.eventoXmlGZipB64) };
    if (status === 400 || status === 401) {
      // The real Sefin sends erro as an array (Stage 1b acceptance); erros and a single object also occur in docs.
      const list = Array.isArray(data.erro)
        ? data.erro
        : Array.isArray(data.erros)
          ? data.erros
          : null;
      const raw = list ? list[0] : data.erro;
      return { kind: 'rejected', error: sefinError(raw) };
    }
    throw httpError(status, body);
  }

  async fetchDfe(nsu: number, cnpj: string): Promise<DfeBatch> {
    const url = `${this.urls.adn}/contribuintes/DFe/${nsu}?cnpjConsulta=${encodeURIComponent(cnpj)}&lote=true`;
    const { status, body } = await this.call('GET', url);
    // The ADN answers 400 and 404 with a full batch body, so read the body before the status.
    const data = body as {
      StatusProcessamento?: DfeBatch['status'];
      LoteDFe?: RawDfeItem[];
      Erros?: unknown[];
    } | null;
    if (data?.StatusProcessamento && (status === 200 || status === 400 || status === 404)) {
      return {
        status: data.StatusProcessamento,
        documents: (data.LoteDFe ?? []).map((item) => ({
          nsu: item.NSU,
          accessKey: item.ChaveAcesso,
          type: item.TipoDocumento,
          ...(item.TipoEvento ? { eventType: item.TipoEvento } : {}),
          xml: tryGunzip(item.ArquivoXml) ?? '',
          createdAt: item.DataHoraGeracao,
        })),
        errors: data.Erros ?? [],
      };
    }
    throw httpError(status, body);
  }

  async checkConvenio(municipality: string): Promise<unknown> {
    const url = `${this.urls.adn}/parametrizacao/${encodeURIComponent(municipality)}/convenio`;
    const { status, body } = await this.call('GET', url);
    if (status !== 200) throw httpError(status, body);
    return body;
  }

  private async call(
    method: 'GET' | 'POST',
    url: string,
    json?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await request(url, {
      method,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        accept: 'application/json',
        ...(json ? { 'content-type': 'application/json' } : {}),
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
    });
    const text = decodeBody(Buffer.from(await response.body.arrayBuffer()));
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Keep the raw text: some 5xx answers are HTML.
    }
    return { status: response.statusCode, body };
  }
}
