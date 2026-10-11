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

test('behind the tunnel the IP is the one Cloudflare saw; from outside the header is ignored', async () => {
  await editCustomer({ 'cf-connecting-ip': '198.51.100.9' }, '172.18.0.5');
  expect(lastRow().ip).toBe('198.51.100.9');
  await t.close();
  t = await createTestApp();
  await editCustomer({ 'cf-connecting-ip': '198.51.100.9' }, '203.0.113.7');
  expect(lastRow().ip).toBe('203.0.113.7');
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
