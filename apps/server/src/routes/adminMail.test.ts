import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { mailOutbox } from '../db/schema';
import { AuditLog } from '../repos/AuditLog';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  seedUser(t.db, 'admin@example.com', 'admin');
  seedUser(t.db, 'pessoa@example.com');
});
afterEach(() => t.close());

function deadLetter(kind: 'invite' | 'code') {
  const at = new Date('2026-10-11T12:00:00Z');
  return t.db
    .insert(mailOutbox)
    .values({
      kind,
      to: 'convidado@example.com',
      subject: 'Convite para a conta Vapulab no NotaFlow',
      html: kind === 'code' ? '' : '<p>convite</p>',
      text: kind === 'code' ? '' : 'convite',
      status: 'failed',
      attempts: 5,
      lastError: 'Error: Resend answered 503',
      nextAttemptAt: at,
      createdAt: at,
    })
    .returning({ id: mailOutbox.id })
    .get().id;
}

test('the platform admin lists the e-mails that failed for good, without their body', async () => {
  deadLetter('invite');
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/admin/mail/failed',
    headers: await t.as('admin@example.com'),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject([
    {
      kind: 'invite',
      to: 'convidado@example.com',
      attempts: 5,
      lastError: 'Error: Resend answered 503',
    },
  ]);
  expect(response.body).not.toContain('<p>convite</p>');
});

test('the admin resends a failed invite, and the resend is audited', async () => {
  const id = deadLetter('invite');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/mail/${id}/retry`,
    payload: {},
    headers: await t.as('admin@example.com'),
  });
  expect(response.json()).toEqual({ sent: true });
  expect(t.mail.at(-1)).toMatchObject({ to: 'convidado@example.com', text: 'convite' });
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ action: 'mail.retry', result: 'ok' });
});

test('a login code is never resent', async () => {
  const id = deadLetter('code');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/admin/mail/${id}/retry`,
    payload: {},
    headers: await t.as('admin@example.com'),
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'mail_not_retryable' });
});

test('only a platform admin sees or resends e-mails', async () => {
  const id = deadLetter('invite');
  const headers = await t.as('pessoa@example.com');
  const list = await t.app.inject({ method: 'GET', url: '/api/admin/mail/failed', headers });
  expect(list.statusCode).toBe(403);
  const retry = await t.app.inject({
    method: 'POST',
    url: `/api/admin/mail/${id}/retry`,
    payload: {},
    headers,
  });
  expect(retry.statusCode).toBe(403);
});
