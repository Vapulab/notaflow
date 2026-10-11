import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

type Row = { ip: string | null; user_agent: string | null; request_id: string | null };
const lastRow = () =>
  t.db.$client
    .prepare('SELECT ip, user_agent, request_id FROM audit_log ORDER BY id DESC LIMIT 1')
    .get() as Row;

async function editCustomer(headers: Record<string, string>, remoteAddress: string) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const id =
    new CustomerRepository(t.db).upsertImported(a, emitter.id, {
      document: { type: 'CNPJ', value: '11222333000181' },
      name: 'Cliente',
    }) ?? '';
  const response = await t.app.inject({
    method: 'PUT',
    url: `/api/accounts/${a.accountId}/customers/${id}`,
    headers: { ...(await t.as('a@example.com')), ...headers },
    payload: { email: 'contas@example.com' },
    remoteAddress,
  });
  expect(response.statusCode).toBe(200);
}

test('an audit entry carries the IP, the browser, and the request id', async () => {
  await editCustomer({ 'user-agent': 'Navegador/1.0' }, '203.0.113.7');
  const row = lastRow();
  expect(row).toMatchObject({ ip: '203.0.113.7', user_agent: 'Navegador/1.0' });
  expect(row.request_id).toMatch(/\S+/);
});

test('with TRUST_CLOUDFLARE_IP, behind the tunnel the IP is the one Cloudflare saw; from outside the header is ignored', async () => {
  await t.close();
  t = await createTestApp({ env: { TRUST_CLOUDFLARE_IP: 'true' } });
  await editCustomer({ 'cf-connecting-ip': '198.51.100.9' }, '172.18.0.5');
  expect(lastRow().ip).toBe('198.51.100.9');
  await t.close();
  t = await createTestApp({ env: { TRUST_CLOUDFLARE_IP: 'true' } });
  await editCustomer({ 'cf-connecting-ip': '198.51.100.9' }, '203.0.113.7');
  expect(lastRow().ip).toBe('203.0.113.7');
});

test('without TRUST_CLOUDFLARE_IP the header is never trusted, so no one can pick an IP to dodge the limits', async () => {
  await editCustomer({ 'cf-connecting-ip': '198.51.100.9' }, '172.18.0.5');
  expect(lastRow().ip).toBe('172.18.0.5');
});

test('an entry written outside a request has no request data', () => {
  new AuditLog(t.db).record({
    userEmail: 'system',
    accountId: null,
    action: 'sync.run',
    entity: 'e1',
    result: 'ok',
  });
  expect(lastRow()).toEqual({ ip: null, user_agent: null, request_id: null });
});

test('the request data stays inside its request, even for the code that awaited it', async () => {
  await editCustomer({ 'user-agent': 'Navegador/1.0' }, '203.0.113.7');
  new AuditLog(t.db).record({
    userEmail: 'system',
    accountId: null,
    action: 'sync.run',
    entity: 'e1',
    result: 'ok',
  });
  expect(lastRow()).toEqual({ ip: null, user_agent: null, request_id: null });
});

test('over real HTTP, a JSON body request still records its browser and id', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const id =
    new CustomerRepository(t.db).upsertImported(a, emitter.id, {
      document: { type: 'CNPJ', value: '11222333000181' },
      name: 'Cliente',
    }) ?? '';
  const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
  const response = await fetch(`${address}/api/accounts/${a.accountId}/customers/${id}`, {
    method: 'PUT',
    headers: {
      ...(await t.as('a@example.com')),
      'content-type': 'application/json',
      'user-agent': 'Navegador/2.0',
    },
    body: JSON.stringify({ email: 'contas@example.com' }),
  });
  expect(response.status).toBe(200);
  const row = lastRow();
  expect(row).toMatchObject({ ip: '127.0.0.1', user_agent: 'Navegador/2.0' });
  expect(row.request_id).toMatch(/\S+/);
});
