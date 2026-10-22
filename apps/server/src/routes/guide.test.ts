import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { AuditLog } from '../repos/AuditLog';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

const CNPJ = '12345678000195';
let t: TestApp;
let agent: MockAgent;
let previous: Dispatcher;
let n = 0;
let ip = '';
let brasilCalls = 0;

const brasilBody = (overrides: object = {}) => ({
  cnpj: CNPJ,
  razao_social: 'EMPRESA TESTE LTDA',
  descricao_situacao_cadastral: 'ATIVA',
  codigo_municipio_ibge: 4113700,
  uf: 'PR',
  opcao_pelo_simples: false,
  opcao_pelo_mei: false,
  ...overrides,
});

const brasil = (status: number, body: object) =>
  agent
    .get('https://brasilapi.com.br')
    .intercept({ path: `/api/cnpj/v1/${CNPJ}`, method: 'GET' })
    .reply(status, () => {
      brasilCalls += 1;
      return body;
    })
    .persist();

async function boot(env: Record<string, string> = {}) {
  agent = new MockAgent();
  agent.disableNetConnect();
  t = await createTestApp({ cnpjDispatcher: agent, env });
}

beforeEach(() => {
  previous = getGlobalDispatcher();
  brasilCalls = 0;
  n += 1;
  ip = `198.19.2.${n}`;
});
afterEach(async () => {
  await t.close();
  setGlobalDispatcher(previous);
});

const regime = (cnpj: string, remoteAddress = ip) =>
  t.app.inject({ method: 'GET', url: `/api/public/cnpj-regime/${cnpj}`, remoteAddress });

describe('regime by CNPJ', () => {
  beforeEach(() => boot());

  test('a masked CNPJ needs no session, and the body holds only the regime', async () => {
    brasil(200, brasilBody({ opcao_pelo_simples: true }));
    const response = await regime('12.345.678%2F0001-95');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ regime: 'simples' });
  });

  test('bad check digits: 400, and no lookup', async () => {
    brasil(200, brasilBody());
    const response = await regime('12345678000190');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_cnpj' });
    expect(brasilCalls).toBe(0);
  });

  test('MEI, Simples, and neither', async () => {
    brasil(200, brasilBody({ opcao_pelo_mei: true }));
    expect((await regime(CNPJ)).json()).toEqual({ regime: 'mei' });
    await t.close();
    await boot();
    brasil(200, brasilBody({ opcao_pelo_simples: true }));
    expect((await regime(CNPJ)).json()).toEqual({ regime: 'simples' });
    await t.close();
    await boot();
    brasil(200, brasilBody());
    expect((await regime(CNPJ)).json()).toEqual({ regime: 'other' });
  });

  test('a company that is not active answers other', async () => {
    brasil(200, brasilBody({ descricao_situacao_cadastral: 'BAIXADA', opcao_pelo_mei: true }));
    const response = await regime(CNPJ);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ regime: 'other' });
  });

  test('not found: 404; both sources down: 503', async () => {
    agent
      .get('https://brasilapi.com.br')
      .intercept({ path: `/api/cnpj/v1/${CNPJ}`, method: 'GET' })
      .reply(404, {});
    expect((await regime(CNPJ)).statusCode).toBe(404);
    await t.close();
    await boot();
    agent
      .get('https://brasilapi.com.br')
      .intercept({ path: `/api/cnpj/v1/${CNPJ}`, method: 'GET' })
      .reply(502, {});
    agent
      .get('https://open.cnpja.com')
      .intercept({ path: `/office/${CNPJ}`, method: 'GET' })
      .reply(503, {});
    const down = await regime(CNPJ);
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({ error: 'cnpj_lookup_unavailable' });
  });

  test('the 31st request from one IP in an hour is refused', async () => {
    brasil(200, brasilBody());
    for (let i = 0; i < 30; i += 1) expect((await regime(CNPJ)).statusCode).toBe(200);
    const response = await regime(CNPJ);
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'too_many_requests' });
    expect((await regime(CNPJ, `${ip}0`)).statusCode).toBe(200);
  });
});

describe('behind the tunnel', () => {
  beforeEach(() => boot({ TRUST_CLOUDFLARE_IP: 'true' }));

  test('each visitor has their own limit, by cf-connecting-ip', async () => {
    brasil(200, brasilBody());
    const from = (visitor: string) =>
      t.app.inject({
        method: 'GET',
        url: `/api/public/cnpj-regime/${CNPJ}`,
        remoteAddress: '172.18.0.5',
        headers: { 'cf-connecting-ip': visitor },
      });
    for (let i = 0; i < 30; i += 1) expect((await from('203.0.113.1')).statusCode).toBe(200);
    expect((await from('203.0.113.1')).statusCode).toBe(429);
    expect((await from('203.0.113.2')).statusCode).toBe(200);
  });
});

describe('notify-me list', () => {
  const post = (body: object, headers: Record<string, string> = {}, remoteAddress = ip) =>
    t.app.inject({
      method: 'POST',
      url: '/api/public/waitlist',
      remoteAddress,
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
      payload: body,
    });
  const rows = () =>
    (t.db.$client.prepare('SELECT count(*) AS n FROM waitlist_signups').get() as { n: number }).n;
  const good = {
    email: 'Pessoa@Example.com',
    interests: ['mei'],
    sourcePage: '/guia/mei',
    turnstileToken: 'good-token',
  };

  describe('with Turnstile', () => {
    beforeEach(async () => {
      agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      agent
        .get('https://challenges.cloudflare.com')
        .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
        .reply(200, (options) => ({ success: String(options.body).includes('good-token') }))
        .persist();
      t = await createTestApp({
        env: { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret' },
      });
    });

    test('a good token: 204 and one row', async () => {
      expect((await post(good)).statusCode).toBe(204);
      expect(rows()).toBe(1);
    });

    test('a bad or missing token: 403 captcha_failed, and no row', async () => {
      const bad = await post({ ...good, turnstileToken: 'bad-token' });
      expect(bad.statusCode).toBe(403);
      expect(bad.json()).toEqual({ error: 'captcha_failed' });
      const { turnstileToken: _omitted, ...without } = good;
      expect((await post(without)).statusCode).toBe(403);
      expect(rows()).toBe(0);
    });

    test('another origin: 403 bad_origin', async () => {
      const response = await post(good, { origin: 'https://evil.example' });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'bad_origin' });
      expect(rows()).toBe(0);
    });

    test('a body that is not JSON: 415', async () => {
      const response = await post(good, { 'content-type': 'text/plain' });
      expect(response.statusCode).toBe(415);
    });

    test('an interest outside the list: 400', async () => {
      expect((await post({ ...good, interests: ['crypto'] })).statusCode).toBe(400);
      expect(rows()).toBe(0);
    });

    test('the 11th signup from one IP in an hour: 429', async () => {
      for (let i = 0; i < 10; i += 1) {
        expect((await post({ ...good, email: `p${i}@example.com` })).statusCode).toBe(204);
      }
      expect((await post(good)).statusCode).toBe(429);
    });
  });

  describe('without Turnstile (dev)', () => {
    beforeEach(() => boot());

    test('the check is skipped', async () => {
      const { turnstileToken: _omitted, ...without } = good;
      expect((await post(without)).statusCode).toBe(204);
      expect(rows()).toBe(1);
    });
  });
});

describe('global CNPJ cap', () => {
  beforeEach(() => boot());

  test('the 301st lookup in an hour from any IP: 503 cnpj_lookup_unavailable, and no lookup', async () => {
    brasil(200, brasilBody());
    for (let i = 0; i < 300; i += 1) {
      expect((await regime(CNPJ, `198.20.${Math.floor(i / 25)}.${i % 25}`)).statusCode).toBe(200);
    }
    const calls = brasilCalls;
    const response = await regime(CNPJ, '198.21.0.1');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'cnpj_lookup_unavailable' });
    expect(brasilCalls).toBe(calls);
  });

  test('a request refused per IP does not use the global quota', async () => {
    brasil(200, brasilBody());
    for (let i = 0; i < 30; i += 1) await regime(CNPJ);
    for (let i = 0; i < 40; i += 1) expect((await regime(CNPJ)).statusCode).toBe(429);
    for (let i = 0; i < 270; i += 1) {
      expect((await regime(CNPJ, `198.22.${Math.floor(i / 25)}.${i % 25}`)).statusCode).toBe(200);
    }
    expect((await regime(CNPJ, '198.23.0.1')).statusCode).toBe(503);
  });
});

describe('admin list', () => {
  beforeEach(async () => {
    await boot();
    seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
    seedUser(t.db, 'admin@example.com', 'admin');
    await t.app.inject({
      method: 'POST',
      url: '/api/public/waitlist',
      remoteAddress: ip,
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: 'x@example.com',
        interests: ['mei', 'certificate'],
        sourcePage: '/guia/mei',
      },
    });
  });

  test('a normal user is refused', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/api/admin/waitlist',
      headers: await t.as('a@example.com'),
    });
    expect(response.statusCode).toBe(403);
  });

  test('an admin gets the list and the counts, and can remove a row', async () => {
    const headers = await t.as('admin@example.com');
    const response = await t.app.inject({ method: 'GET', url: '/api/admin/waitlist', headers });
    const body = response.json<{ signups: { id: string; email: string }[]; counts: object }>();
    expect(body.signups.map((s) => s.email)).toEqual(['x@example.com']);
    expect(body.counts).toEqual({ mei: 1, lucro_presumido: 0, certificate: 1 });
    const id = body.signups[0]?.id ?? '';
    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/waitlist/${id}`,
      headers,
      payload: {},
    });
    expect(removed.statusCode).toBe(204);
    const entry = new AuditLog(t.db).list().find((e) => e.action === 'waitlist.remove');
    expect(entry).toMatchObject({ userEmail: 'admin@example.com', entity: id, result: 'ok' });
    const after = await t.app.inject({ method: 'GET', url: '/api/admin/waitlist', headers });
    expect(after.json<{ signups: unknown[] }>().signups).toHaveLength(0);
    const again = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/waitlist/${id}`,
      headers,
      payload: {},
    });
    expect(again.statusCode).toBe(404);
  });
});
