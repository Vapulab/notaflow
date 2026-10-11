import { MockAgent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
let agent: MockAgent;
beforeEach(async () => {
  agent = new MockAgent();
  agent.disableNetConnect();
  t = await createTestApp({ cnpjDispatcher: agent });
});
afterEach(() => t.close());

function emitter(cnaes: string[] | null) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const row = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
    ...(cnaes ? { cnaes: JSON.stringify(cnaes) } : {}),
  });
  return `/api/accounts/${a.accountId}/emitters/${row.id}/service-codes/suggested`;
}

type Answer = { cnaes: string[]; codes: { code: string }[] };
const get = async (url: string) =>
  t.app.inject({ method: 'GET', url, headers: await t.as('a@example.com') });

test("the codes come from the emitter's CNAEs, group by group", async () => {
  const response = await get(emitter(['6201501', '7319002']));
  expect(response.statusCode).toBe(200);
  const body = response.json<Answer>();
  expect(body.cnaes).toEqual(['6201501', '7319002']);
  expect([...new Set(body.codes.map((c) => c.code.slice(0, 2)))]).toEqual(['01', '17', '23']);
});

test('an emitter from before stage 3c gets its CNAEs from the public lookup once', async () => {
  agent
    .get('https://brasilapi.com.br')
    .intercept({ path: '/api/cnpj/v1/12345678000195', method: 'GET' })
    .reply(200, {
      descricao_situacao_cadastral: 'ATIVA',
      codigo_municipio_ibge: 4113700,
      cnae_fiscal: 6201501,
      cnaes_secundarios: [{ codigo: 8599604, descricao: 'Treinamento' }],
    });
  const url = emitter(null);
  expect((await get(url)).json<Answer>().cnaes).toEqual(['6201501', '8599604']);
  // The second call reads the stored CNAEs: the mock answers only once.
  expect((await get(url)).json<Answer>().cnaes).toEqual(['6201501', '8599604']);
});

test('when the lookup is down there are no suggestions, and nothing breaks', async () => {
  agent.get('https://brasilapi.com.br').intercept({ path: /cnpj/, method: 'GET' }).reply(503, '');
  agent
    .get('https://open.cnpja.com')
    .intercept({ path: /office/, method: 'GET' })
    .reply(503, '');
  const response = await get(emitter(null));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ cnaes: [], codes: [] });
});
