import { MockAgent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
let viaCep: MockAgent;
beforeEach(async () => {
  viaCep = new MockAgent();
  viaCep.disableNetConnect();
  t = await createTestApp({ cepDispatcher: viaCep });
});
afterEach(() => t.close());

const answer = (path: string, status: number, body: string | object) =>
  viaCep.get('https://viacep.com.br').intercept({ path, method: 'GET' }).reply(status, body);

async function lookup(cep: string, email = 'a@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  return t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/cep/${cep}`,
    headers: await t.as(email),
  });
}

test('a CEP answers the street, the district, and the IBGE municipality', async () => {
  answer('/ws/86010000/json/', 200, {
    cep: '86010-000',
    logradouro: 'Rua Teste',
    bairro: 'Centro',
    localidade: 'Londrina',
    uf: 'PR',
    ibge: '4113700',
  });
  const response = await lookup('86010000');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    zip: '86010000',
    street: 'Rua Teste',
    district: 'Centro',
    municipality: { code: '4113700', name: 'Londrina', uf: 'PR' },
  });
});

test('an unknown CEP is cep_not_found', async () => {
  answer('/ws/99999999/json/', 200, { erro: 'true' });
  const response = await lookup('99999999');
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ error: 'cep_not_found' });
});

test('ViaCEP down is cep_unavailable', async () => {
  answer('/ws/86010000/json/', 500, 'down');
  const response = await lookup('86010000');
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'cep_unavailable' });
});

test('a CEP that is not 8 digits is invalid_cep', async () => {
  const response = await lookup('123');
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'invalid_cep' });
});
