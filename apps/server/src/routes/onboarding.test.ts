import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { makeTestCertificate } from '@notaflow/test-kit';
import { syntheticCard } from '../../test/syntheticCard';
import { createTestApp, type TestApp } from '../../test/testApp';
import { EmitterRepository } from '../repos/EmitterRepository';
import { OnboardingRepository } from '../repos/OnboardingRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const call = async (method: 'GET' | 'POST', url: string, email: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: await t.as(email),
    ...(method === 'POST' ? { payload: payload ?? {} } : {}),
  });

async function newAccount(email = 'nova@example.com') {
  seedUser(t.db, email);
  const response = await call('POST', '/api/onboarding/account', email, { name: 'Minha Empresa' });
  expect(response.statusCode).toBe(201);
  return (response.json() as { accountId: string }).accountId;
}

test('a new user names the account, becomes its owner, and goes to the card step', async () => {
  const accountId = await newAccount();
  const me = await call('GET', '/api/me', 'nova@example.com');
  expect(me.json()).toMatchObject({
    accounts: [{ id: accountId, name: 'Minha Empresa', role: 'owner', onboardingStep: 'card' }],
  });
  const state = await call('GET', `/api/accounts/${accountId}/onboarding`, 'nova@example.com');
  expect(state.json()).toEqual({ step: 'card', draft: null, municipalityName: null });
  const entry = t.db.$client
    .prepare("SELECT result FROM audit_log WHERE action = 'account.create'")
    .get();
  expect(entry).toEqual({ result: 'ok' });
});

test('a user who already belongs to an account cannot create another one this way', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const response = await call('POST', '/api/onboarding/account', 'a@example.com', {
    name: 'Outra',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'already_has_account' });
});

test('an empty or overlong name is refused', async () => {
  seedUser(t.db, 'nova@example.com');
  for (const name of ['', '   ', 'x'.repeat(121)]) {
    const response = await call('POST', '/api/onboarding/account', 'nova@example.com', { name });
    expect(response.statusCode, JSON.stringify(name)).toBe(400);
  }
});

test('the steps move only forward and only from the step they expect', async () => {
  const accountId = await newAccount();
  const repo = new OnboardingRepository(t.db);
  const ctx = { accountId, userId: 'u', role: 'owner' as const, accountStatus: 'active' as const };
  expect(repo.advance(ctx, 'certificate', 'fiscal')).toBe(false);
  expect(repo.step(ctx)).toBe('card');
  expect(repo.advance(ctx, 'card', 'certificate')).toBe(true);
  expect(repo.advance(ctx, 'card', 'certificate')).toBe(false);

  const early = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/fiscal-done`,
    'nova@example.com',
  );
  expect(early.statusCode).toBe(409);
  expect(early.json()).toMatchObject({ error: 'onboarding_step', step: 'certificate' });

  repo.advance(ctx, 'certificate', 'fiscal');
  const fiscal = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/fiscal-done`,
    'nova@example.com',
  );
  expect(fiscal.statusCode).toBe(200);
  expect(fiscal.json()).toEqual({ step: 'sync' });
  const finish = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/finish`,
    'nova@example.com',
  );
  expect(finish.json()).toEqual({ step: 'done' });
});

test('only the owner moves the steps', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'dono@example.com' });
  seedTenant(t.db, { accountName: 'B', email: 'membro@example.com' });
  t.db.$client
    .prepare(
      "INSERT INTO memberships (id, user_id, account_id, role) SELECT 'm9', id, ?, 'member' FROM users WHERE email = 'membro@example.com'",
    )
    .run(a.accountId);
  for (const step of ['fiscal-done', 'finish']) {
    const response = await call(
      'POST',
      `/api/accounts/${a.accountId}/onboarding/${step}`,
      'membro@example.com',
    );
    expect(response.statusCode, step).toBe(403);
  }
});

describe('the card step', () => {
  let agent: MockAgent;
  let c: TestApp;
  beforeEach(async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    c = await createTestApp({ cnpjDispatcher: agent });
  });
  afterEach(() => c.close());

  const answer = (body: object) =>
    agent
      .get('https://brasilapi.com.br')
      .intercept({ path: '/api/cnpj/v1/12345678000195', method: 'GET' })
      .reply(200, body);
  const active = {
    razao_social: 'EMPRESA TESTE LTDA',
    nome_fantasia: null,
    descricao_situacao_cadastral: 'ATIVA',
    codigo_municipio_ibge: 4113700,
    uf: 'PR',
    cnae_fiscal: 6201501,
    opcao_pelo_simples: true,
    opcao_pelo_mei: false,
  };
  async function start() {
    seedUser(c.db, 'nova@example.com');
    const created = await c.app.inject({
      method: 'POST',
      url: '/api/onboarding/account',
      headers: await c.as('nova@example.com'),
      payload: { name: 'Minha Empresa' },
    });
    return (created.json() as { accountId: string }).accountId;
  }
  const sendCard = async (accountId: string, pdf: Buffer) =>
    c.app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/onboarding/card`,
      headers: await c.as('nova@example.com'),
      payload: { pdfBase64: pdf.toString('base64'), fileName: 'cartao.pdf' },
    });
  const documents = () =>
    c.db.$client
      .prepare('SELECT cnpj, sha256, size_bytes, content_gzip FROM account_documents')
      .all() as {
      cnpj: string;
      sha256: string;
      size_bytes: number;
      content_gzip: Buffer;
    }[];

  test('a card is read, looked up, stored gzipped, and the step moves to the certificate', async () => {
    const accountId = await start();
    answer(active);
    const pdf = await syntheticCard();
    const response = await sendCard(accountId, pdf);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      draft: {
        cnpj: '12345678000195',
        legalName: 'EMPRESA TESTE LTDA',
        tradeName: null,
        municipality: '4113700',
        uf: 'PR',
        cnae: '6201501',
        simplesNacional: '3',
        source: 'brasilapi',
      },
      nameMismatch: false,
      municipalityName: 'Londrina',
    });
    const [doc] = documents();
    expect(doc?.cnpj).toBe('12345678000195');
    expect(doc?.size_bytes).toBe(pdf.length);
    expect(doc?.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(gunzipSync(doc?.content_gzip ?? Buffer.alloc(0)).equals(pdf)).toBe(true);
    const state = await c.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/onboarding`,
      headers: await c.as('nova@example.com'),
    });
    expect(state.json()).toMatchObject({ step: 'certificate', draft: { cnpj: '12345678000195' } });
  });

  test('a legal name on the card that differs from the lookup is flagged, not refused', async () => {
    const accountId = await start();
    answer({ ...active, razao_social: 'OUTRO NOME LTDA' });
    const response = await sendCard(accountId, await syntheticCard());
    expect(response.json()).toMatchObject({ nameMismatch: true });
  });

  test('a CNPJ that is already an emitter of another account is refused at the card', async () => {
    const other = seedTenant(c.db, { accountName: 'Outra', email: 'outra@example.com' });
    new EmitterRepository(c.db).create(other, {
      cnpj: '12345678000195',
      companyName: 'EMPRESA',
      municipality: '4113700',
      simplesNacional: '3',
      specialRegime: '0',
      dpsSeries: '900',
    });
    const accountId = await start();
    const response = await sendCard(accountId, await syntheticCard());
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'cnpj_in_other_account' });
    expect(documents()).toEqual([]);
  });

  test('the card step at another step is refused', async () => {
    const accountId = await start();
    answer(active);
    await sendCard(accountId, await syntheticCard());
    const again = await sendCard(accountId, await syntheticCard());
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'onboarding_step', step: 'certificate' });
  });

  test('an unreadable card answers 422 and keeps the step', async () => {
    const accountId = await start();
    const response = await sendCard(accountId, Buffer.from('not a pdf'));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'card_unreadable' });
  });

  test('a card over 2 MB answers 413', async () => {
    const accountId = await start();
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2 * 1024 * 1024)]);
    const response = await sendCard(accountId, big);
    expect(response.statusCode).toBe(413);
  });

  test('a lookup outage answers 502 and keeps the step', async () => {
    const accountId = await start();
    agent.get('https://brasilapi.com.br').intercept({ path: /cnpj/, method: 'GET' }).reply(503, '');
    agent
      .get('https://open.cnpja.com')
      .intercept({ path: /office/, method: 'GET' })
      .reply(503, '');
    const response = await sendCard(accountId, await syntheticCard());
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'cnpj_lookup_unavailable' });
    expect(documents()).toEqual([]);
  });

  test('a typed CNPJ is the fallback: same checks, no document', async () => {
    const accountId = await start();
    answer(active);
    const response = await c.app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/onboarding/cnpj`,
      headers: await c.as('nova@example.com'),
      payload: { cnpj: '12.345.678/0001-95' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ draft: { cnpj: '12345678000195' } });
    expect(documents()).toEqual([]);
  });
  const certificateOf = (cnpj: string) => makeTestCertificate({ cnpj });
  const sendCertificate = async (
    accountId: string,
    cert: { pfx: Buffer; password: string },
    password = cert.password,
  ) =>
    c.app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/onboarding/certificate`,
      headers: await c.as('nova@example.com'),
      payload: { pfxBase64: cert.pfx.toString('base64'), password },
    });
  const emitterRows = () =>
    c.db.$client
      .prepare(
        'SELECT cnpj, municipality, simples_nacional, simples_regime, special_regime, dps_series, environment FROM emitters',
      )
      .all();
  const stepOf = (accountId: string) =>
    (
      c.db.$client
        .prepare('SELECT onboarding_step AS step FROM accounts WHERE id = ?')
        .get(accountId) as {
        step: string;
      }
    ).step;

  async function atCertificate() {
    const accountId = await start();
    answer(active);
    expect((await sendCard(accountId, await syntheticCard())).statusCode).toBe(200);
    return accountId;
  }

  test('a certificate of another CNPJ than the card is refused, and nothing is stored', async () => {
    const accountId = await atCertificate();
    const response = await sendCertificate(accountId, certificateOf('11222333000181'));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'certificate_cnpj_mismatch' });
    expect(emitterRows()).toEqual([]);
    expect(c.db.$client.prepare('SELECT count(*) AS n FROM certificates').get()).toEqual({ n: 0 });
    expect(stepOf(accountId)).toBe('certificate');
  });

  test('the matching certificate creates the emitter from the card data, in production', async () => {
    const accountId = await atCertificate();
    const response = await sendCertificate(accountId, certificateOf('12345678000195'));
    expect(response.statusCode).toBe(201);
    expect(emitterRows()).toEqual([
      {
        cnpj: '12345678000195',
        municipality: '4113700',
        simples_nacional: '3',
        simples_regime: '1',
        special_regime: '0',
        dps_series: '900',
        environment: 'producao',
      },
    ]);
    expect(stepOf(accountId)).toBe('fiscal');
  });

  test('two certificates at once make one emitter; the other is told it exists', async () => {
    const accountId = await atCertificate();
    const cert = certificateOf('12345678000195');
    const answers = await Promise.all([
      sendCertificate(accountId, cert),
      sendCertificate(accountId, cert),
    ]);
    expect(answers.map((a) => a.statusCode).sort()).toEqual([201, 409]);
    expect(emitterRows()).toHaveLength(1);
    expect(stepOf(accountId)).toBe('fiscal');
  });

  test('a wrong certificate password keeps the step', async () => {
    const accountId = await atCertificate();
    const response = await sendCertificate(accountId, certificateOf('12345678000195'), 'errada');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'WRONG_PASSWORD' });
    expect(stepOf(accountId)).toBe('certificate');
  });
  test('the answers name the municipality, and "Trocar cartão" goes back to the card step', async () => {
    const accountId = await atCertificate();
    const state = await c.app.inject({
      method: 'GET',
      url: `/api/accounts/${accountId}/onboarding`,
      headers: await c.as('nova@example.com'),
    });
    expect(state.json()).toMatchObject({ step: 'certificate', municipalityName: 'Londrina' });
    const back = await c.app.inject({
      method: 'POST',
      url: `/api/accounts/${accountId}/onboarding/back-to-card`,
      headers: await c.as('nova@example.com'),
      payload: {},
    });
    expect(back.json()).toEqual({ step: 'card' });
    expect(stepOf(accountId)).toBe('card');
    answer(active);
    expect((await sendCard(accountId, await syntheticCard())).json()).toMatchObject({
      municipalityName: 'Londrina',
    });
  });
});
