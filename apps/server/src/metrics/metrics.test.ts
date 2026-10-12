import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedUser } from '../../test/fixtures';
import { COMPETENCE, withNewInvoiceSetup } from '../../test/newInvoiceSetup';
import { createTestApp, type TestApp } from '../../test/testApp';
import { mailOutbox } from '../db/schema';
import { moduleOf } from './metrics';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test.each([
  ['/api/auth/email-otp/send-verification-otp', 'auth'],
  ['/api/me', 'auth'],
  ['/api/me/legal-acceptance', 'auth'],
  ['/api/admin/accounts', 'admin'],
  ['/api/admin/mail/:id/retry', 'admin'],
  ['/api/accounts/:accountId/onboarding/card', 'onboarding'],
  ['/api/accounts/:accountId/invoices/new', 'issue'],
  ['/api/accounts/:accountId/invoices/issue', 'issue'],
  ['/api/accounts/:accountId/invoices/:invoiceId/cancel', 'issue'],
  ['/api/accounts/:accountId/invoices/:invoiceId/reconcile', 'issue'],
  ['/api/accounts/:accountId/emitters/:emitterId/sync', 'sync'],
  ['/api/accounts/:accountId/customers', 'app'],
  ['/api/health', 'app'],
  ['/entrar', 'web'],
])('the route %s belongs to the module %s', (route, module) => {
  expect(moduleOf(route)).toBe(module);
});

test('every request is counted and timed by module, method, and status', async () => {
  seedUser(t.db, 'pessoa@example.com');
  await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('pessoa@example.com') });
  await t.app.inject({ method: 'GET', url: '/api/health' });
  const text = await t.app.metrics.render();
  expect(text).toMatch(/http_requests_total\{module="auth",method="GET",status="200"\} 1/);
  expect(text).toMatch(/http_requests_total\{module="app",method="GET",status="200"\} 1/);
  expect(text).toMatch(/http_request_duration_seconds_count\{module="auth"\} 1/);
});

test('an issued invoice counts by result', async () => {
  const s = await withNewInvoiceSetup(t);
  const response = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  expect(response.json()).toMatchObject({ status: 'issued' });
  expect(await t.app.metrics.render()).toMatch(/invoices_issued_total\{result="issued"\} 1/);
});

test('the mail outbox shows its pending and dead letters', async () => {
  const at = new Date();
  for (const status of ['failed', 'failed', 'pending'] as const) {
    t.db
      .insert(mailOutbox)
      .values({
        kind: 'invite',
        to: 'x@example.com',
        subject: 's',
        html: '',
        text: '',
        status,
        nextAttemptAt: at,
        createdAt: at,
      })
      .run();
  }
  const text = await t.app.metrics.render();
  expect(text).toMatch(/mail_outbox_messages\{status="failed"\} 2/);
  expect(text).toMatch(/mail_outbox_messages\{status="pending"\} 1/);
});

test("each emitter's certificate expiry is a gauge, by internal id and never by CNPJ", async () => {
  const s = await withNewInvoiceSetup(t);
  const text = await t.app.metrics.render();
  expect(text).toMatch(
    new RegExp(`certificate_expiry_timestamp_seconds\\{emitter="${s.emitterId}"\\} \\d+`),
  );
  expect(text).not.toMatch(/\d{14}"/);
});

test('a sync run counts by result and keeps the time of the last success', async () => {
  const s = await withNewInvoiceSetup(t);
  await t.app.syncService.syncEmitter(s.a, s.emitterId);
  const text = await t.app.metrics.render();
  expect(text).toMatch(/sync_runs_total\{result="ok"\} 1/);
  expect(text).toMatch(
    new RegExp(`sync_last_success_timestamp_seconds\\{emitter="${s.emitterId}"\\} \\d+`),
  );
});

test('every log line of a request, the completion line too, carries its module', async () => {
  const lines: string[] = [];
  const logged = await createTestApp({ logStream: { write: (line: string) => lines.push(line) } });
  await logged.app.inject({ method: 'GET', url: '/api/health' });
  await logged.close();
  const completed = lines
    .map((line) => JSON.parse(line))
    .find((l) => l.msg === 'request completed');
  expect(completed).toMatchObject({ module: 'app' });
});

test('the business totals count accounts, users, emitters, and invoices by origin, status, and environment', async () => {
  const s = await withNewInvoiceSetup(t);
  const issued = await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 123400,
  });
  const invoiceId = issued.json<{ id: string }>().id;
  await s.call('POST', '/invoices/new', {
    emitterId: s.emitterId,
    customerId: s.brazilId,
    serviceId: s.serviceId,
    competence: COMPETENCE,
    serviceCents: 5000,
  });
  const cancel = await s.call('POST', `/invoices/${invoiceId}/cancel`, {
    reason: '1',
    justification: 'Valor informado errado na nota',
  });
  expect(cancel.statusCode).toBe(200);

  const text = await t.app.metrics.render();
  expect(text).toMatch(/notaflow_accounts\{status="active"\} 1/);
  expect(text).toMatch(/notaflow_accounts\{status="suspended"\} 0/);
  expect(text).toMatch(/notaflow_users 1/);
  expect(text).toMatch(/notaflow_emitters\{environment="producao"\} 1/);
  expect(text).toMatch(/notaflow_emitters\{environment="producao_restrita"\} 0/);
  expect(text).toMatch(
    /notaflow_invoices\{origin="app",status="issued",environment="producao"\} 1/,
  );
  expect(text).toMatch(
    /notaflow_invoices\{origin="app",status="cancelled",environment="producao"\} 1/,
  );
});

test('the lifecycle e-mails sent are counted by phase and step', async () => {
  const user = seedUser(t.db, 'dono@example.com');
  t.db.$client.prepare("INSERT INTO accounts (id, name, created_at) VALUES ('a-l', 'A', 1)").run();
  t.db.$client
    .prepare(
      `INSERT INTO lifecycle_emails (user_id, account_id, phase, step, variant, anchor_at, sent_at)
       VALUES (?, 'a-l', 'activation', 1, 'card', 1, 2)`,
    )
    .run(user);
  const text = await t.app.metrics.render();
  expect(text).toMatch(/notaflow_lifecycle_emails\{phase="activation",step="1"\} 1/);
});
