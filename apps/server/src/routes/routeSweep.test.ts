import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { providerInvoice } from '../../test/providerData';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { ServiceRepository } from '../repos/ServiceRepository';

let t: TestApp;
let params: Record<string, string>;

beforeAll(async () => {
  t = await createTestApp();
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  seedUser(t.db, 'admin@example.com', 'admin');
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const invoice = new InvoiceRepository(t.db).upsertSynced(a, emitter.id, providerInvoice(), null);
  const customerId = new CustomerRepository(t.db).upsertImported(a, emitter.id, {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
  });
  const service = new ServiceRepository(t.db).create(a, emitter.id, {
    name: 'Consultoria',
    nationalTaxCode: '010101',
    description: 'Consultoria',
  });
  params = {
    serviceId: service.id,
    cep: '86010000',
    accountId: a.accountId,
    emitterId: emitter.id,
    userId: a.userId,
    invoiceId: invoice.id,
    customerId: customerId ?? '',
  };
});
afterAll(() => t.close());

const PUBLIC = new Set(['GET /api/health', 'GET /api/public/config']);

function fill(url: string): string {
  return url.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`The sweep has no value for :${name}; add it to params.`);
    return value;
  });
}

function bodyFor(method: string) {
  return method === 'GET' ? {} : { payload: {} };
}

describe('every /api route', () => {
  test('the sweep sees the routes of this plan', () => {
    const urls = t.app.routeList.map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual(
      expect.arrayContaining([
        'GET /api/me',
        'POST /api/admin/accounts',
        'POST /api/accounts/:accountId/emitters',
        'POST /api/accounts/:accountId/emitters/:emitterId/environment',
      ]),
    );
  });

  test('requires authentication', async () => {
    for (const route of t.app.routeList) {
      if (!route.url.startsWith('/api/') || PUBLIC.has(`${route.method} ${route.url}`)) continue;
      // Better Auth owns its routes; the next test covers them.
      if (route.url.startsWith('/api/auth/')) continue;
      const response = await t.app.inject({ method: route.method as 'GET', url: fill(route.url) });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  test('answers 404 to a user of another account, on every account route', async () => {
    const headers = await t.as('b@example.com');
    const routes = t.app.routeList.filter((r) => r.url.startsWith('/api/accounts/:accountId'));
    for (const route of routes) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...bodyFor(route.method),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
    }
  });

  test('answers 403 admin_only to an account owner, on every admin route', async () => {
    const headers = await t.as('a@example.com');
    for (const route of t.app.routeList.filter((r) => r.url.startsWith('/api/admin/'))) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...bodyFor(route.method),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });

  test('a percent-encoded /api path still goes through the auth hook and the mutation guard', async () => {
    const headers = { ...(await t.as('a@example.com')), 'content-type': 'text/plain' };
    const response = await t.app.inject({
      method: 'POST',
      url: `/%61pi/accounts/${params.accountId ?? ''}/members`,
      headers,
      payload: 'x',
    });
    expect(response.statusCode).toBe(415);
  });

  test('the Better Auth routes answer without a session and never open one', async () => {
    const session = await t.app.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toBeNull();
    const sessions = () =>
      (t.db.$client.prepare('SELECT count(*) AS n FROM auth_sessions').get() as { n: number }).n;
    const before = sessions();
    const out = await t.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: {},
    });
    expect(out.statusCode).toBeLessThan(500);
    expect(sessions()).toBe(before);
  });

  test('the public configuration needs no session and holds no secret', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      googleEnabled: false,
      turnstileSiteKey: null,
      signupOpen: true,
    });
  });

  test('a query string on the health route needs no authentication', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/health?probe=1' });
    expect(response.statusCode).toBe(200);
  });

  test('a platform admin without a membership gets 404 on account routes', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: fill('/api/accounts/:accountId/emitters'),
      headers: await t.as('admin@example.com'),
    });
    expect(response.statusCode).toBe(404);
  });
});
