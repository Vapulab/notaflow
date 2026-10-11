import { MockAgent } from 'undici';
import { beforeEach, expect, test } from 'vitest';
import { LookupError, lookupCnpj } from './cnpjLookup';

const CNPJ = '12345678000195';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

const brasil = (status: number, body: object | string = {}) =>
  agent
    .get('https://brasilapi.com.br')
    .intercept({ path: `/api/cnpj/v1/${CNPJ}`, method: 'GET' })
    .reply(status, body);
const cnpja = (status: number, body: object | string = {}) =>
  agent
    .get('https://open.cnpja.com')
    .intercept({ path: `/office/${CNPJ}`, method: 'GET' })
    .reply(status, body);

const brasilBody = (overrides: object = {}) => ({
  cnpj: CNPJ,
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'TESTE',
  descricao_situacao_cadastral: 'ATIVA',
  codigo_municipio_ibge: 4113700,
  uf: 'PR',
  cnae_fiscal: 6201501,
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  ...overrides,
});
const cnpjaBody = (overrides: object = {}) => ({
  taxId: CNPJ,
  alias: null,
  status: { id: 2, text: 'Ativa' },
  company: {
    name: 'EMPRESA TESTE LTDA',
    simples: { optant: true },
    simei: { optant: true },
  },
  address: { municipality: 4113700, state: 'PR' },
  mainActivity: { id: 6201501 },
  ...overrides,
});

const lookup = () => lookupCnpj(CNPJ, { dispatcher: agent, timeoutMs: 200 });
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof LookupError ? error.code : String(error)),
  );

test('BrasilAPI: an active Simples company that is not MEI is option 3', async () => {
  brasil(200, brasilBody());
  expect(await lookup()).toEqual({
    cnpj: CNPJ,
    legalName: 'EMPRESA TESTE LTDA',
    tradeName: 'TESTE',
    municipality: '4113700',
    uf: 'PR',
    cnae: '6201501',
    simplesNacional: '3',
    source: 'brasilapi',
  });
});

test.each([
  [{ opcao_pelo_mei: true }, '2'],
  [{ opcao_pelo_simples: false, opcao_pelo_mei: false }, '1'],
  [{ opcao_pelo_simples: null, opcao_pelo_mei: null }, '1'],
])('BrasilAPI Simples mapping %o gives %s', async (overrides, option) => {
  brasil(200, brasilBody(overrides));
  expect((await lookup()).simplesNacional).toBe(option);
});

test.each([503, 429])(
  'a BrasilAPI %s falls back to CNPJá with the same mapping',
  async (status) => {
    brasil(status, 'erro');
    cnpja(200, cnpjaBody());
    expect(await lookup()).toMatchObject({
      simplesNacional: '2',
      municipality: '4113700',
      source: 'cnpja',
    });
  },
);

test('a BrasilAPI that does not answer in time falls back to CNPJá', async () => {
  agent
    .get('https://brasilapi.com.br')
    .intercept({ path: `/api/cnpj/v1/${CNPJ}`, method: 'GET' })
    .reply(200, brasilBody())
    .delay(1000);
  cnpja(200, cnpjaBody());
  expect((await lookup()).source).toBe('cnpja');
});

test('both sources down: the lookup is unavailable, and nothing is guessed', async () => {
  brasil(502);
  cnpja(503);
  expect(await errorOf(lookup())).toBe('cnpj_lookup_unavailable');
});

test('a company that is not active is refused with its status', async () => {
  brasil(200, brasilBody({ descricao_situacao_cadastral: 'BAIXADA' }));
  const error = await lookup().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LookupError);
  expect((error as LookupError).code).toBe('cnpj_not_active');
  expect((error as LookupError).status).toBe('BAIXADA');
});

test.each([400, 404])('a CNPJ BrasilAPI does not know (%s) is not found', async (status) => {
  brasil(status, { message: 'CNPJ inválido' });
  expect(await errorOf(lookup())).toBe('cnpj_not_found');
});
