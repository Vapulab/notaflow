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
  const band6 = { ...withoutIss, simplesRbt12Cents: 400_000_000 };
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

test('the fiscal config says whether the main CNAE depends on the fator R', async () => {
  const { a, url } = withEmitter();
  const headers = await t.as('a@example.com');
  const emitterId = url.split('/').at(-2) ?? '';
  const repo = new EmitterRepository(t.db);
  const ctx = { ...a, role: 'owner' as const, accountStatus: 'active' as const };
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    fatorR: null,
  });
  repo.setCnaes(ctx, emitterId, ['4330404']);
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    fatorR: false,
  });
  repo.setCnaes(ctx, emitterId, ['7112000']);
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    fatorR: true,
  });
});
