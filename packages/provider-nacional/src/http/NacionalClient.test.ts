import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { loadCertificate } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent, MockAgent, request } from 'undici';
import { beforeEach, describe, expect, test } from 'vitest';
import { createMtlsDispatcher } from './createMtlsDispatcher';
import { gunzipBase64, gzipBase64 } from './gzipBase64';
import { isDuplicateDps, NacionalClient } from './NacionalClient';

const SEFIN = 'https://sefin.producaorestrita.nfse.gov.br';
const ADN = 'https://adn.producaorestrita.nfse.gov.br';
const KEY = '3'.repeat(50);
const DPS_ID = 'DPS355030821234567800019500900000000000000001';
const DFE_PATH = (nsu: number) => `/contribuintes/DFe/${nsu}?cnpjConsulta=12345678000195&lote=true`;

let agent: MockAgent;
let client: NacionalClient;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  client = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: agent,
    timeoutMs: 200,
  });
});

test('gzipBase64 round-trips accented XML', () => {
  const xml = '<a>ção &amp; análise</a>';
  expect(gunzipBase64(gzipBase64(xml))).toBe(xml);
});

test('createMtlsDispatcher builds an Agent from PEM material', () => {
  const testCert = makeTestCertificate();
  expect(createMtlsDispatcher(loadCertificate(testCert.pfx, testCert.password))).toBeInstanceOf(
    Agent,
  );
});

test('the urls option sends requests to another host', async () => {
  const local = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: agent,
    urls: { sefin: 'http://127.0.0.1:4010/SefinNacional', adn: 'http://127.0.0.1:4010/adn' },
  });
  agent
    .get('http://127.0.0.1:4010')
    .intercept({ path: '/adn/parametrizacao/3550308/convenio', method: 'GET' })
    .reply(200, { mensagem: 'ok' });
  expect(await local.checkConvenio('3550308')).toEqual({ mensagem: 'ok' });
});

describe('mTLS handshake', () => {
  const server = makeTestCertificate({ altNames: [{ ip: '127.0.0.1' }] });
  const clientCert = makeTestCertificate({ cnpj: '12345678000195' });

  async function withServer(run: (url: string) => Promise<void>): Promise<void> {
    const https = createServer(
      {
        key: server.privateKeyPem,
        cert: server.certificatePem,
        ca: [clientCert.certificatePem],
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        res.end(String(peer.subject.CN));
      },
    );
    await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
    try {
      await run(`https://127.0.0.1:${(https.address() as AddressInfo).port}/`);
    } finally {
      https.closeAllConnections();
      await new Promise((resolve) => https.close(resolve));
    }
  }

  test('presents the client certificate to a server that requires one', async () => {
    const dispatcher = createMtlsDispatcher(loadCertificate(clientCert.pfx, clientCert.password), {
      ca: server.certificatePem,
    });
    await withServer(async (url) => {
      const response = await request(url, { dispatcher });
      expect(await response.body.text()).toBe('EMPRESA TESTE LTDA:12345678000195');
    });
  });

  test('the same server refuses a connection without a client certificate', async () => {
    const dispatcher = new Agent({ connect: { ca: server.certificatePem } });
    await withServer(async (url) => {
      await expect(request(url, { dispatcher })).rejects.toThrow();
    });
  });
});

describe('issue', () => {
  test('201 returns issued with the decompressed NFS-e', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(201, {
        idDps: DPS_ID,
        chaveAcesso: KEY,
        nfseXmlGZipB64: gzipBase64('<NFSe/>'),
        alertas: [],
      });
    expect(await client.issue('<DPS/>')).toEqual({
      kind: 'issued',
      accessKey: KEY,
      dpsId: DPS_ID,
      nfseXml: '<NFSe/>',
      alerts: [],
    });
  });

  test('sends the DPS as gzip + base64 in dpsXmlGZipB64', async () => {
    let body = '';
    agent
      .get(SEFIN)
      .intercept({
        path: '/SefinNacional/nfse',
        method: 'POST',
        body: (b) => {
          body = b;
          return true;
        },
      })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') });
    await client.issue('<DPS>ç</DPS>');
    expect(gunzipBase64((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><DPS>ç</DPS>',
    );
  });

  test('keeps an XML declaration that is already there', async () => {
    let body = '';
    agent
      .get(SEFIN)
      .intercept({
        path: '/SefinNacional/nfse',
        method: 'POST',
        body: (b) => {
          body = b;
          return true;
        },
      })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') });
    await client.issue('<?xml version="1.0" encoding="utf-8"?><DPS/>');
    expect(gunzipBase64((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toBe(
      '<?xml version="1.0" encoding="utf-8"?><DPS/>',
    );
  });

  test('400 returns rejected with the Sefin errors', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(400, { idDPS: DPS_ID, erros: [{ codigo: 'E0014', descricao: 'DPS duplicada' }] });
    expect(await client.issue('<DPS/>')).toEqual({
      kind: 'rejected',
      dpsId: DPS_ID,
      errors: [{ codigo: 'E0014', descricao: 'DPS duplicada' }],
    });
  });

  test('400 reads the capitalized Codigo and Descricao the Sefin sends', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(400, { idDPS: DPS_ID, erros: [{ Codigo: 'E1229', Descricao: 'Xml inválido' }] });
    expect(await client.issue('<DPS/>')).toEqual({
      kind: 'rejected',
      dpsId: DPS_ID,
      errors: [{ codigo: 'E1229', descricao: 'Xml inválido' }],
    });
  });

  test('reads an error body the Sefin encodes as Latin-1', async () => {
    const latin1 = Buffer.from(
      JSON.stringify({ erros: [{ Codigo: 'E0014', Descricao: 'Série e Número já existem' }] }),
      'latin1',
    );
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(400, latin1, { headers: { 'content-type': 'application/json' } });
    expect(await client.issue('<DPS/>')).toMatchObject({
      errors: [{ codigo: 'E0014', descricao: 'Série e Número já existem' }],
    });
  });

  test('500 returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(500, 'boom');
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });

  test('a 201 without an access key returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(201, {});
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });

  test('a 201 with an access key but no NFS-e XML returns uncertain with the key', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY });
    expect(await client.issue('<DPS/>')).toMatchObject({ kind: 'uncertain', accessKey: KEY });
  });

  test('a 201 with corrupt NFS-e XML returns uncertain with the key', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: 'not-gzip' });
    expect(await client.issue('<DPS/>')).toMatchObject({ kind: 'uncertain', accessKey: KEY });
  });

  test('a timeout returns uncertain', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') })
      .delay(1000);
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });
});

describe('findByDpsId', () => {
  test('200 returns found', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' })
      .reply(200, { idDps: DPS_ID, chaveAcesso: KEY });
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'found', accessKey: KEY });
  });

  test('404 returns not_found', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' })
      .reply(404, {});
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'not_found' });
  });

  test('a 404 with an HTML body throws a retryable error', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' })
      .reply(404, '<html>Not Found</html>');
    await expect(client.findByDpsId(DPS_ID)).rejects.toMatchObject({
      name: 'NacionalHttpError',
      status: 404,
      retryable: true,
    });
  });

  test('a 404 with an empty body throws a retryable error', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' })
      .reply(404, '');
    await expect(client.findByDpsId(DPS_ID)).rejects.toMatchObject({ retryable: true });
  });
});

describe('registerEvent', () => {
  test('201 returns registered', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(201, { eventoXmlGZipB64: gzipBase64('<evento/>') });
    expect(await client.registerEvent(KEY, '<pedRegEvento/>')).toEqual({
      kind: 'registered',
      eventXml: '<evento/>',
    });
  });

  test('a 201 without event XML returns registered with a null eventXml', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(201, {});
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({ kind: 'registered', eventXml: null });
  });

  test('a 201 with corrupt event XML returns registered with a null eventXml', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(201, { eventoXmlGZipB64: 'not-gzip' });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({ kind: 'registered', eventXml: null });
  });

  test('sends the event with an UTF-8 XML declaration', async () => {
    let body = '';
    agent
      .get(SEFIN)
      .intercept({
        path: `/SefinNacional/nfse/${KEY}/eventos`,
        method: 'POST',
        body: (b) => {
          body = b;
          return true;
        },
      })
      .reply(201, { eventoXmlGZipB64: gzipBase64('<evento/>') });
    await client.registerEvent(KEY, '<pedRegEvento/>');
    const sent = JSON.parse(body) as { pedidoRegistroEventoXmlGZipB64: string };
    expect(gunzipBase64(sent.pedidoRegistroEventoXmlGZipB64)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><pedRegEvento/>',
    );
  });

  test('400 returns rejected with the single erro object', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, { erro: { codigo: 'E1234', descricao: 'Prazo expirado' } });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({
      kind: 'rejected',
      error: { codigo: 'E1234', descricao: 'Prazo expirado' },
    });
  });

  test('400 with erro as an array (the real Sefin, seen in the Stage 1b acceptance) returns the first error', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, {
        tipoAmbiente: 2,
        erro: [{ codigo: 'E0840', descricao: 'Evento de cancelamento já vinculado à NFS-e' }],
      });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({
      kind: 'rejected',
      error: { codigo: 'E0840', descricao: 'Evento de cancelamento já vinculado à NFS-e' },
    });
  });

  test('400 with an erros array returns the first error', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, { erros: [{ Codigo: 'E0840', Descricao: 'NFS-e já cancelada' }] });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({
      kind: 'rejected',
      error: { codigo: 'E0840', descricao: 'NFS-e já cancelada' },
    });
  });
});

test('isDuplicateDps is true only for E0014', () => {
  expect(isDuplicateDps([{ codigo: 'E0014', descricao: 'x' }])).toBe(true);
  expect(isDuplicateDps([{ codigo: 'E0001', descricao: 'x' }])).toBe(false);
  expect(isDuplicateDps([])).toBe(false);
});

describe('fetchDfe', () => {
  test('decodes each document', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(0), method: 'GET' })
      .reply(200, {
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: [
          {
            NSU: 1,
            ChaveAcesso: KEY,
            TipoDocumento: 'NFSE',
            ArquivoXml: gzipBase64('<NFSe/>'),
            DataHoraGeracao: '2026-10-08T10:00:00',
          },
        ],
        Erros: [],
      });
    const batch = await client.fetchDfe(0, '12345678000195');
    expect(batch.status).toBe('DOCUMENTOS_LOCALIZADOS');
    expect(batch.documents).toEqual([
      { nsu: 1, accessKey: KEY, type: 'NFSE', xml: '<NFSe/>', createdAt: '2026-10-08T10:00:00' },
    ]);
  });

  test('404 with NENHUM_DOCUMENTO_LOCALIZADO is an empty batch, not an error', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(42), method: 'GET' })
      .reply(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] });
    expect(await client.fetchDfe(42, '12345678000195')).toEqual({
      status: 'NENHUM_DOCUMENTO_LOCALIZADO',
      documents: [],
      errors: [],
    });
  });

  test('a document with a corrupt ArquivoXml keeps the batch, with an empty xml', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(0), method: 'GET' })
      .reply(200, {
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: [
          {
            NSU: 1,
            ChaveAcesso: KEY,
            TipoDocumento: 'NFSE',
            ArquivoXml: 'not-gzip',
            DataHoraGeracao: '2026-10-01T10:00:00',
          },
        ],
        Erros: [],
      });
    expect((await client.fetchDfe(0, '12345678000195')).documents[0]?.xml).toBe('');
  });

  test('429 throws a retryable error', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(0), method: 'GET' })
      .reply(429, {});
    await expect(client.fetchDfe(0, '12345678000195')).rejects.toMatchObject({ retryable: true });
  });
});
