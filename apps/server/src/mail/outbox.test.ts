import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDatabase } from '../db/openDatabase';
import { mailOutbox } from '../db/schema';
import type { MailMessage } from './mailer';
import { MailSuppressionRepository } from '../repos/MailSuppressionRepository';
import { MailOutbox } from './outbox';

let opened: ReturnType<typeof openDatabase>;
let sent: MailMessage[];
let failing: boolean;
let errors: string[];
let outbox: MailOutbox;
const T0 = new Date('2026-10-11T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const message = { to: 'pessoa@example.com', subject: 'Assunto', html: '<p>oi</p>', text: 'oi' };

beforeEach(() => {
  opened = openDatabase(':memory:');
  sent = [];
  failing = false;
  errors = [];
  outbox = new MailOutbox(
    opened.db,
    async (m) => {
      if (failing) throw new Error('Resend answered 503');
      sent.push(m);
    },
    (line) => errors.push(line),
  );
});
afterEach(() => opened.close());

const rows = () => opened.db.select().from(mailOutbox).all();

test('a message is stored, sent at once, and its body is erased once sent', async () => {
  expect(await outbox.send(message, 'invite', T0)).toBe(true);
  expect(sent).toEqual([{ ...message, kind: 'invite' }]);
  expect(rows()).toMatchObject([
    { status: 'sent', attempts: 1, html: '', text: '', to: 'pessoa@example.com', kind: 'invite' },
  ]);
});

test('a failed send stays pending and is retried after 1, 5, 30, and 120 minutes', async () => {
  failing = true;
  expect(await outbox.send(message, 'invite', T0)).toBe(false);
  expect(rows()[0]).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'Error: Resend answered 503',
  });
  expect(rows()[0]?.nextAttemptAt).toEqual(minutes(1));
  // Not yet due: nothing happens.
  await outbox.deliverDue(minutes(0.5));
  expect(rows()[0]?.attempts).toBe(1);
  await outbox.deliverDue(minutes(1));
  expect(rows()[0]).toMatchObject({ attempts: 2, nextAttemptAt: minutes(6) });
  failing = false;
  await outbox.deliverDue(minutes(6));
  expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 3 });
  expect(sent).toHaveLength(1);
});

test('after the fifth failure the message goes to the dead-letter state and the log says so', async () => {
  failing = true;
  await outbox.send(message, 'invite', T0);
  for (const at of [1, 6, 36, 156]) await outbox.deliverDue(minutes(at));
  expect(rows()[0]).toMatchObject({ status: 'failed', attempts: 5 });
  expect(errors.join('\n')).toContain('gave up');
  expect(outbox.failed()).toHaveLength(1);
});

test('an admin retry sends a failed message again now', async () => {
  failing = true;
  await outbox.send(message, 'invite', T0);
  for (const at of [1, 6, 36, 156]) await outbox.deliverDue(minutes(at));
  failing = false;
  const id = rows()[0]?.id ?? 0;
  expect(await outbox.retry(id, minutes(200))).toBe(true);
  expect(rows()[0]).toMatchObject({ status: 'sent' });
  expect(sent).toEqual([{ ...message, kind: 'invite' }]);
});

test('a login code is useless after 10 minutes: it is not retried later, its body is erased, and it cannot be resent', async () => {
  failing = true;
  await outbox.send(message, 'code', T0);
  await outbox.deliverDue(minutes(1));
  await outbox.deliverDue(minutes(11));
  expect(rows()[0]).toMatchObject({ status: 'failed', html: '', text: '' });
  failing = false;
  expect(await outbox.retry(rows()[0]?.id ?? 0, minutes(12))).toBe(false);
  expect(sent).toEqual([]);
});

test('a slow worker never sends the same message twice at once', async () => {
  failing = true;
  await outbox.send(message, 'invite', T0);
  failing = false;
  await Promise.all([outbox.deliverDue(minutes(1)), outbox.deliverDue(minutes(1))]);
  expect(sent).toHaveLength(1);
});

test('a message left as sending by a crash is picked up again after 5 minutes', async () => {
  opened.db
    .insert(mailOutbox)
    .values({ ...message, kind: 'invite', status: 'sending', nextAttemptAt: T0, createdAt: T0 })
    .run();
  await outbox.deliverDue(minutes(2));
  expect(sent).toEqual([]);
  await outbox.deliverDue(minutes(6));
  expect(sent).toEqual([{ ...message, kind: 'invite' }]);
});

test('a queued lifecycle e-mail goes out with its reply-to and unsubscribe headers', async () => {
  const headers = {
    'List-Unsubscribe': '<https://x/u>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  outbox.queue({ ...message, replyTo: 'contato@vapulab.com', headers }, 'lifecycle', T0);
  expect(sent).toHaveLength(0);
  await outbox.deliverDue(T0);
  expect(sent[0]).toMatchObject({ replyTo: 'contato@vapulab.com', headers });
});

test('a cancelled lifecycle e-mail is never sent; only pending lifecycle rows of that address are cancelled', async () => {
  outbox.queue({ ...message, subject: 'a' }, 'lifecycle', T0);
  outbox.queue({ ...message, subject: 'b' }, 'invite', T0);
  outbox.queue({ ...message, to: 'outra@example.com', subject: 'c' }, 'lifecycle', T0);
  expect(outbox.cancelPendingLifecycle('pessoa@example.com')).toBe(1);
  await outbox.deliverDue(T0);
  expect(sent.map((m) => m.subject).sort()).toEqual(['b', 'c']);
  const statuses = opened.db.select({ s: mailOutbox.status }).from(mailOutbox).all();
  expect(statuses.map((r) => r.s).sort()).toEqual(['cancelled', 'sent', 'sent']);
});

test('an opt-out also cancels a failed lifecycle e-mail, so the admin retry cannot send it', async () => {
  failing = true;
  const id = outbox.queue({ ...message, subject: 'lembrete' }, 'lifecycle', T0);
  for (const m of [0, 1, 6, 36, 156]) await outbox.deliverDue(minutes(m));
  const row = () => opened.db.select({ s: mailOutbox.status }).from(mailOutbox).get();
  expect(row()?.s).toBe('failed');
  expect(outbox.cancelPendingLifecycle('pessoa@example.com')).toBe(1);
  failing = false;
  expect(await outbox.retry(id, minutes(200))).toBe(false);
  expect(row()?.s).toBe('cancelled');
  expect(sent).toHaveLength(0);
});

test('an e-mail sent at once also keeps its reply-to and headers', async () => {
  await outbox.send(
    {
      ...message,
      replyTo: 'contato@vapulab.com',
      headers: { 'List-Unsubscribe': '<https://x/u>' },
    },
    'lifecycle',
    T0,
  );
  expect(sent[0]).toMatchObject({
    replyTo: 'contato@vapulab.com',
    headers: { 'List-Unsubscribe': '<https://x/u>' },
  });
});

test('the transport learns the kind of each message', async () => {
  await outbox.send(message, 'invoice', T0);
  expect(sent[0]?.kind).toBe('invoice');
});

test('cancelPendingInvoice cancels pending and failed invoice rows of that address only', async () => {
  outbox.queue({ ...message, subject: 'a' }, 'invoice', T0);
  outbox.queue({ ...message, subject: 'b' }, 'lifecycle', T0);
  outbox.queue({ ...message, to: 'outra@example.com', subject: 'c' }, 'invoice', T0);
  expect(outbox.cancelPendingInvoice('Pessoa@example.com')).toBe(1);
  await outbox.deliverDue(T0);
  expect(sent.map((m) => m.subject).sort()).toEqual(['b', 'c']);
});

test('delivery skips an invoice row whose address is suppressed', async () => {
  const id = outbox.queue({ ...message, subject: 'nota' }, 'invoice', T0);
  new MailSuppressionRepository(opened.db).add('pessoa@example.com', 'invoice');
  await outbox.deliverDue(T0);
  expect(sent).toHaveLength(0);
  expect(rows().find((r) => r.id === id)).toMatchObject({ status: 'cancelled', html: '' });
});
