import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  escapeXml,
  formatBrasiliaDateTime,
  gunzipBase64,
  gzipBase64,
} from '@notaflow/provider-nacional';
import { buildAccessKey, buildEventXml, buildNfseXml, readDps } from './fakeXml';

export type FakeRoute = 'issue' | 'getNfse' | 'getDps' | 'event' | 'dfe' | 'convenio' | 'danfse';
export type FakeOutcome =
  { kind: 'reply'; status: number; body: unknown } | { kind: 'delay'; ms: number };

export interface FakeNacional {
  urls: { sefin: string; adn: string };
  next(route: FakeRoute, outcome: FakeOutcome): void;
  reset(): void;
  issuedCount(): number;
  close(): Promise<void>;
}

interface FakeInvoice {
  accessKey: string;
  dpsId: string;
  emitterCnpj: string;
  nfseXml: string;
  cancelled: boolean;
}

export interface FakeDfeEntry {
  nsu: number;
  accessKey: string;
  emitterCnpj: string;
  type: 'NFSE' | 'EVENTO';
  eventType?: string;
  xml: string;
  createdAt: string;
}

interface Reply {
  status: number;
  body: unknown;
  // A non-JSON answer, such as the DANFS-e PDF.
  raw?: { contentType: string; bytes: Buffer };
}

type Handler = (match: RegExpMatchArray, body: string, url: URL) => Reply;

const E0014 =
  'Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente.';

export class FakeState {
  invoices = new Map<string, FakeInvoice>();
  keysByDpsId = new Map<string, string>();
  dfe: FakeDfeEntry[] = [];
  nfseCount = 0;

  addDfe(entry: Omit<FakeDfeEntry, 'nsu' | 'createdAt'>): void {
    this.dfe.push({ ...entry, nsu: this.dfe.length + 1, createdAt: new Date().toISOString() });
  }
}

export async function startFakeNacional(
  options: { port?: number; emitterName?: string } = {},
): Promise<FakeNacional> {
  let state = new FakeState();
  const queue = new Map<FakeRoute, FakeOutcome[]>();
  const emitterName = escapeXml(options.emitterName ?? 'EMPRESA TESTE LTDA');

  const routes: { route: FakeRoute; method: string; pattern: RegExp; handle: Handler }[] = [
    { route: 'issue', method: 'POST', pattern: /^\/SefinNacional\/nfse$/, handle: issue },
    {
      route: 'getNfse',
      method: 'GET',
      pattern: /^\/SefinNacional\/nfse\/([0-9A-Z]{50})$/,
      handle: getNfse,
    },
    {
      route: 'getDps',
      method: 'GET',
      pattern: /^\/SefinNacional\/dps\/([0-9A-Z]+)$/,
      handle: getDps,
    },
    {
      route: 'event',
      method: 'POST',
      pattern: /^\/SefinNacional\/nfse\/([0-9A-Z]{50})\/eventos$/,
      handle: event,
    },
    { route: 'dfe', method: 'GET', pattern: /^\/adn\/contribuintes\/DFe\/([0-9]+)$/, handle: dfe },
    { route: 'danfse', method: 'GET', pattern: /^\/adn\/danfse\/([0-9A-Z]{50})$/, handle: danfse },
    {
      route: 'convenio',
      method: 'GET',
      pattern: /^\/adn\/parametrizacao\/([0-9]{7})\/convenio$/,
      handle: convenio,
    },
  ];

  function issue(_match: RegExpMatchArray, body: string): Reply {
    const dpsXml = gunzipBase64((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64);
    if (!dpsXml.startsWith('<?xml')) {
      return reject(400, 'E1229', 'Xml não está utilizando codificação UTF-8.');
    }
    const dps = readDps(dpsXml);
    if (state.keysByDpsId.has(dps.id)) {
      return {
        status: 400,
        body: { idDPS: dps.id, erros: [{ Codigo: 'E0014', Descricao: E0014 }] },
      };
    }
    const now = new Date();
    const nfseNumber = ++state.nfseCount;
    const accessKey = buildAccessKey(dps, nfseNumber, now);
    const processedAt = formatBrasiliaDateTime(now);
    const nfseXml = buildNfseXml({ accessKey, nfseNumber, processedAt, emitterName, dps, dpsXml });
    state.invoices.set(accessKey, {
      accessKey,
      dpsId: dps.id,
      emitterCnpj: dps.cnpj,
      nfseXml,
      cancelled: false,
    });
    state.keysByDpsId.set(dps.id, accessKey);
    state.addDfe({ accessKey, emitterCnpj: dps.cnpj, type: 'NFSE', xml: nfseXml });
    return {
      status: 201,
      body: {
        tipoAmbiente: 2,
        versaoAplicativo: 'fake-nacional',
        dataHoraProcessamento: processedAt,
        idDps: dps.id,
        chaveAcesso: accessKey,
        nfseXmlGZipB64: gzipBase64(nfseXml),
        alertas: [],
      },
    };
  }

  function getNfse(match: RegExpMatchArray): Reply {
    const invoice = state.invoices.get(match[1] ?? '');
    if (!invoice) return reject(404, 'E0404', 'NFS-e não encontrada.');
    return {
      status: 200,
      body: { chaveAcesso: invoice.accessKey, nfseXmlGZipB64: gzipBase64(invoice.nfseXml) },
    };
  }

  function danfse(match: RegExpMatchArray): Reply {
    const accessKey = match[1] ?? '';
    if (!state.invoices.get(accessKey)) return { status: 404, body: null };
    const pdf = `%PDF-1.4
% NotaFlow fake DANFS-e ${accessKey}
%%EOF
`;
    return {
      status: 200,
      body: null,
      raw: { contentType: 'application/pdf', bytes: Buffer.from(pdf, 'latin1') },
    };
  }

  function getDps(match: RegExpMatchArray): Reply {
    const accessKey = state.keysByDpsId.get(match[1] ?? '');
    // Stage 0 run 2: the real Sefin answers an unknown DPS id with a JSON 404.
    if (!accessKey) return reject(404, 'E0404', 'DPS não encontrada.');
    return { status: 200, body: { idDps: match[1], chaveAcesso: accessKey } };
  }

  function event(match: RegExpMatchArray, body: string): Reply {
    const invoice = state.invoices.get(match[1] ?? '');
    if (!invoice) return reject(404, 'E0404', 'NFS-e não encontrada.');
    const requestXml = gunzipBase64(
      (JSON.parse(body) as { pedidoRegistroEventoXmlGZipB64: string })
        .pedidoRegistroEventoXmlGZipB64,
    );
    if (!requestXml.startsWith('<?xml')) {
      return reject(400, 'E1229', 'Xml não está utilizando codificação UTF-8.');
    }
    if (invoice.cancelled) {
      // The real rejection body is unknown (RFC Stage 0 Results); this is the shape the client reads.
      return { status: 400, body: { erro: { Codigo: 'E0840', Descricao: 'NFS-e já cancelada.' } } };
    }
    const code = /<e([0-9]{6})>/.exec(requestXml)?.[1] ?? '101101';
    const eventXml = buildEventXml({
      accessKey: invoice.accessKey,
      code,
      processedAt: formatBrasiliaDateTime(new Date()),
      requestXml,
    });
    invoice.cancelled = code === '101101' || invoice.cancelled;
    state.addDfe({
      accessKey: invoice.accessKey,
      emitterCnpj: invoice.emitterCnpj,
      type: 'EVENTO',
      eventType: code,
      xml: eventXml,
    });
    return { status: 201, body: { eventoXmlGZipB64: gzipBase64(eventXml) } };
  }

  function dfe(match: RegExpMatchArray, _body: string, url: URL): Reply {
    const after = Number(match[1]);
    const cnpj = url.searchParams.get('cnpjConsulta');
    const entries = state.dfe.filter((e) => e.nsu > after && e.emitterCnpj === cnpj).slice(0, 50);
    if (entries.length === 0) {
      return {
        status: 404,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] },
      };
    }
    return {
      status: 200,
      body: {
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: entries.map((e) => ({
          NSU: e.nsu,
          ChaveAcesso: e.accessKey,
          TipoDocumento: e.type,
          ...(e.eventType ? { TipoEvento: e.eventType } : {}),
          ArquivoXml: gzipBase64(e.xml),
          DataHoraGeracao: e.createdAt,
        })),
        Erros: [],
      },
    };
  }

  function convenio(): Reply {
    return {
      status: 200,
      body: {
        parametrosConvenio: {
          aderenteAmbienteNacional: 1,
          aderenteEmissorNacional: 1,
          situacaoEmissaoPadraoContribuintesRFB: 1,
          aderenteMAN: 0,
          permiteAproveitametoDeCreditos: true,
        },
        mensagem: 'Parâmetros do convênio recuperados com sucesso.',
      },
    };
  }

  function reject(status: number, code: string, message: string): Reply {
    return { status, body: { erros: [{ Codigo: code, Descricao: message }] } };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readBody(request);
    if (request.method === 'POST' && url.pathname === '/__fake/next') {
      const { route, ...outcome } = JSON.parse(body) as { route: FakeRoute } & FakeOutcome;
      fake.next(route, outcome as FakeOutcome);
      return send(response, { status: 204, body: null });
    }
    if (request.method === 'POST' && url.pathname === '/__fake/reset') {
      fake.reset();
      return send(response, { status: 204, body: null });
    }
    for (const { route, method, pattern, handle: run } of routes) {
      const match = request.method === method ? url.pathname.match(pattern) : null;
      if (!match) continue;
      const outcome = queue.get(route)?.shift();
      if (outcome?.kind === 'reply') return send(response, outcome);
      const reply = run(match, body, url);
      // A delay keeps the state change, like a real timeout after the Sefin stored the invoice.
      if (outcome?.kind === 'delay')
        await new Promise((resolve) => setTimeout(resolve, outcome.ms));
      return send(response, reply);
    }
    send(response, { status: 404, body: { erro: 'no fake route' } });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, {
        status: 500,
        body: { erro: error instanceof Error ? error.message : String(error) },
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const fake: FakeNacional = {
    urls: { sefin: `${base}/SefinNacional`, adn: `${base}/adn` },
    next(route, outcome) {
      queue.set(route, [...(queue.get(route) ?? []), outcome]);
    },
    issuedCount() {
      return state.invoices.size;
    },
    reset() {
      state = new FakeState();
      queue.clear();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return fake;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, reply: Reply): void {
  // The client may have given up already (a delay scenario); writing then is harmless.
  if (response.writableEnded || response.destroyed) return;
  if (reply.raw) {
    response.writeHead(reply.status, { 'content-type': reply.raw.contentType });
    response.end(reply.raw.bytes);
    return;
  }
  response.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(reply.body === null ? '' : JSON.stringify(reply.body));
}
