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
  simplesBand: 1,
  issRate: 200,
  ibscbsRegime: 'inside_das',
  ibscbsRegimeFrom: '2026-07-01',
};

test('the owner saves the fiscal configuration; the server takes the percent from the band', async () => {
  const { a, url } = withEmitter();
  const headers = await t.as('a@example.com');
  const saved = await t.app.inject({ method: 'PUT', url, headers, payload: body });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual({ ...body, simplesPercent: 600 });
  const read = await t.app.inject({ method: 'GET', url, headers });
  expect(read.json()).toMatchObject({ ...body, simplesPercent: 600 });
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    accountId: a.accountId,
    action: 'emitter.fiscal',
    result: 'ok',
    detail: 'III/1 6.00%, ISS 2.00%, inside_das from 2026-07-01',
  });
});

test('band 2 of Annex V gives 18.00%', async () => {
  const { url } = withEmitter();
  const saved = await t.app.inject({
    method: 'PUT',
    url,
    headers: await t.as('a@example.com'),
    payload: { ...body, simplesAnnex: 'V', simplesBand: 2 },
  });
  expect(saved.json()).toMatchObject({ simplesPercent: 1800 });
});

test('a band outside 1 to 6 or an ISS rate above 5% is refused', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  for (const payload of [
    { ...body, simplesBand: 7 },
    { ...body, issRate: 501 },
  ]) {
    expect((await t.app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(400);
  }
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

test('the fiscal answer carries the band table, with or without a configuration', async () => {
  const { url } = withEmitter();
  const headers = await t.as('a@example.com');
  const bands = {
    III: [600, 1120, 1350, 1600, 2100, 3300],
    V: [1550, 1800, 1950, 2050, 2300, 3050],
  };
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    simplesPercent: null,
    bands,
  });
  await t.app.inject({ method: 'PUT', url, headers, payload: body });
  expect((await t.app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
    simplesPercent: 600,
    bands,
  });
});
