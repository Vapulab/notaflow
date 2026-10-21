import type { AccountRole } from '@notaflow/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

function withEmitter(options: { role?: AccountRole; status?: 'active' | 'suspended' } = {}) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com', ...options });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  return { a, url: `/api/accounts/${a.accountId}/emitters/${emitter.id}/fiscal` };
}

const body = {
  simplesAnnex: 'III',
  simplesRbt12Cents: 12_000_000,
  issRate: 200,
  ibscbsRegime: 'inside_das',
  ibscbsRegimeFrom: '2026-07-01',
};

test('the owner saves the revenue of the last 12 months; the server derives the band and the rates', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const saved = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesRbt12Cents: 18_470_000 },
  });
  expect(saved.statusCode).toBe(200);
  const read = (await t.app.inject({ method: 'GET', url, headers })).json();
  expect(read).toMatchObject({
    simplesAnnex: 'III',
    simplesBand: 2,
    simplesRbt12Cents: 18_470_000,
    simplesRbt12At: expect.any(String),
    // The effective rate of Anexo III band 2, and on an export without ISS, Cofins, and PIS.
    rates: { domestic: 613, export: 312, iss: 196 },
    // The ISS share of the band (CGSN 140, art. 27), not the typed rate.
    issRate: 196,
  });
  const entry = new AuditLog(t.db).list().at(-1);
  expect(entry).toMatchObject({ action: 'emitter.fiscal', result: 'ok' });
});

test('a revenue above the Simples limit or an ISS rate above 5% is refused', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const over = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesRbt12Cents: 480_000_001 },
  });
  expect(over.statusCode).toBe(400);
  const iss = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, issRate: 501 },
  });
  expect(iss.statusCode).toBe(400);
});

test('a preview gives the band and both rates for any revenue, without saving', async () => {
  const { a } = withEmitter();
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/simples-rates?annex=V&rbt12Cents=10000000`,
    headers: await t.as('a@example.com'),
  });
  expect(response.json()).toEqual({ band: 1, domestic: 1550, export: 1067, iss: 217 });
  const outside = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/simples-rates?annex=III&rbt12Cents=500000000`,
    headers: await t.as('a@example.com'),
  });
  expect(outside.statusCode).toBe(400);
  expect(outside.json()).toMatchObject({ error: 'outside_simples' });
});

test('a member reads the configuration but cannot change it', async () => {
  const { url } = withEmitter({ role: 'member' });
  const headers = await t.as('a@example.com');
  expect((await t.app.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
  const write = await t.app.inject({ method: 'PUT', url, headers, payload: body });
  expect(write.statusCode).toBe(403);
  expect(write.json()).toMatchObject({ error: 'owner_only' });
});

test('a suspended account cannot change it', async () => {
  const { url } = withEmitter({ status: 'suspended' });
  const write = await t.app.inject({
    method: 'PUT',
    url,
    headers: await t.as('a@example.com'),
    payload: body,
  });
  expect(write.statusCode).toBe(403);
});

test('an emitter of another account is not found', async () => {
  const { url } = withEmitter();
  seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const other = url.replace(/emitters\/[^/]+/, 'emitters/someone-else');
  const response = await t.app.inject({
    method: 'GET',
    url: other,
    headers: await t.as('a@example.com'),
  });
  expect(response.statusCode).toBe(404);
});

test('without a revenue the answer has no rates', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    simplesRbt12Cents: null,
    rates: null,
  });
});

test('the ISS rate comes from the band; only band 6, outside the DAS, takes a typed one', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const { issRate: _typed, ...withoutIss } = body;
  const derived = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...withoutIss, simplesRbt12Cents: 21_600_000 },
  });
  expect(derived.json()).toMatchObject({ issRate: 220, rates: { iss: 220 } });
  const band6 = { ...withoutIss, simplesRbt12Cents: 400_000_000, simplesBand6Iss: 'outside' };
  const missing = await t.app.inject({ method: 'PUT', url, headers, payload: band6 });
  expect(missing.statusCode).toBe(400);
  expect(missing.json()).toMatchObject({ error: 'iss_rate_required' });
  const typed = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...band6, issRate: 300 },
  });
  expect(typed.json()).toMatchObject({ issRate: 300, rates: { iss: null } });
});

// CGSN 140, art. 21 III b and art. 24 I: the ISS stays in the DAS until the impediment takes effect.
test('band 6 asks where the ISS goes; while it stays in the DAS the rates include it', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const { issRate: _typed, ...withoutIss } = body;
  const band6 = { ...withoutIss, simplesRbt12Cents: 450_000_000 };
  const unanswered = await t.app.inject({ method: 'PUT', url, headers, payload: band6 });
  expect(unanswered.statusCode).toBe(400);
  expect(unanswered.json()).toMatchObject({ error: 'band6_iss_required' });
  const under = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...band6, simplesBand6Iss: 'under_sublimit' },
  });
  expect(under.statusCode).toBe(200);
  // PGDAS-D manual, Exemplo 8: 18.60% + 6.09968%, with the ISS capped at 5%.
  const read = (await t.app.inject({ method: 'GET', url, headers })).json();
  expect(read).toMatchObject({
    simplesBand: 6,
    simplesBand6Iss: 'under_sublimit',
    simplesPercent: 2470,
    rates: { domestic: 2470, export: 1581, iss: 500 },
    issRate: 500,
  });
  const over = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...band6, simplesBand6Iss: 'over_sublimit' },
  });
  expect(over.json()).toMatchObject({ rates: { domestic: 2447, iss: 500 } });
});

test('outside band 6, and in Anexos I and II, the answer is not asked and not kept', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const band5 = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesRbt12Cents: 350_000_000, simplesBand6Iss: 'under_sublimit' },
  });
  expect(band5.json()).toMatchObject({ simplesBand6Iss: null, rates: { iss: 500 } });
  const annexI = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesAnnex: 'I', simplesRbt12Cents: 400_000_000 },
  });
  expect(annexI.statusCode).toBe(200);
  expect(annexI.json()).toMatchObject({ simplesBand6Iss: null, issRate: 200 });
});

test('the rates preview takes the band 6 answer', async () => {
  const { a } = withEmitter();
  const headers = await t.as('a@example.com');
  const preview = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/simples-rates?annex=III&rbt12Cents=450000000&band6Iss=under_sublimit`,
    headers,
  });
  expect(preview.json()).toEqual({ band: 6, domestic: 2470, export: 1581, iss: 500 });
  const outside = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/simples-rates?annex=III&rbt12Cents=450000000`,
    headers,
  });
  expect(outside.json()).toEqual({ band: 6, domestic: 1860, export: 1497, iss: null });
});

test('the fiscal config suggests the annex of the main CNAE', async () => {
  const { a, url } = withEmitter();
  const headers = await t.as('a@example.com');
  const emitterId = url.split('/').at(-2) ?? '';
  const repo = new EmitterRepository(t.db);
  const ctx = { ...a, role: 'owner' as const, accountStatus: 'active' as const };
  const read = async () => (await t.app.inject({ method: 'GET', url, headers })).json();
  expect(await read()).toMatchObject({ annexRule: null });
  repo.setCnaes(ctx, emitterId, ['4330404']);
  expect(await read()).toMatchObject({ annexRule: 'IV' });
  repo.setCnaes(ctx, emitterId, ['7112000']);
  expect(await read()).toMatchObject({ annexRule: 'fator_r' });
  repo.setCnaes(ctx, emitterId, ['9602501']);
  expect(await read()).toMatchObject({ annexRule: 'III' });
});

test('every annex of the Simples is accepted; Anexo IV band 1 is 4.50%', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  for (const simplesAnnex of ['I', 'II', 'III', 'IV', 'V']) {
    const saved = await t.app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { ...body, simplesAnnex, simplesRbt12Cents: 14_205_029 },
    });
    expect(saved.statusCode, simplesAnnex).toBe(200);
  }
  await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesAnnex: 'IV', simplesRbt12Cents: 14_205_029 },
  });
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    simplesAnnex: 'IV',
    rates: { domestic: 450, export: 153, iss: 200 },
  });
  const refused = await t.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { ...body, simplesAnnex: 'VI' },
  });
  expect(refused.statusCode).toBe(400);
});
