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
