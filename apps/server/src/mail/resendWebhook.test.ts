import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  postWebhook as post,
  signWebhook as sign,
  WEBHOOK_SECRET as SECRET,
} from '../../test/resendWebhookRequest';
import { createTestApp, type TestApp } from '../../test/testApp';
import { mailOutbox, mailSuppressions } from '../db/schema';
import { MailSuppressionRepository } from '../repos/MailSuppressionRepository';
import { RESEND_WEBHOOK_PATH, validSvixSignature } from './resendWebhook';

const CUSTOMER = 'cliente@example.com';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

async function setup(options: { secret?: string | null; ids?: string[] } = {}) {
  const ids = [...(options.ids ?? [])];
  t = await createTestApp({
    env: options.secret === null ? {} : { RESEND_WEBHOOK_SECRET: options.secret ?? SECRET },
    mailId: () => ids.shift(),
  });
  return t;
}

function event(type: string, emailId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type,
    created_at: '2026-10-29T12:00:00.000Z',
    data: { email_id: emailId, to: [CUSTOMER], ...extra },
  });
}

const permanentBounce = (id: string) =>
  event('email.bounced', id, { bounce: { type: 'Permanent', subType: 'General' } });

async function sendInvoiceMail(app: TestApp, to = CUSTOMER): Promise<void> {
  await app.app.mailOutbox.send(
    {
      to,
      subject: 'Nota fiscal',
      html: '<p>nota</p>',
      text: 'nota',
      kind: 'invoice',
      ref: { accountId: 'acc-1', invoiceId: 'inv-1' },
    },
    'invoice',
  );
}

const suppressions = (app: TestApp) => new MailSuppressionRepository(app.db);
const rowOf = (app: TestApp, providerId: string) =>
  app.db.select().from(mailOutbox).where(eq(mailOutbox.providerId, providerId)).get();

test('the route answers 404 without a secret', async () => {
  const app = await setup({ secret: null });
  expect((await post(app, permanentBounce('re_x'))).statusCode).toBe(404);
});

test('a bad signature, a missing header, and a timestamp 6 minutes old answer 401', async () => {
  const app = await setup();
  const body = permanentBounce('re_x');
  expect((await post(app, body, { signature: `v1,${sign('msg_1', '1', body)}` })).statusCode).toBe(
    401,
  );
  const missing = await app.app.inject({
    method: 'POST',
    url: RESEND_WEBHOOK_PATH,
    headers: { 'content-type': 'application/json' },
    payload: body,
  });
  expect(missing.statusCode).toBe(401);
  const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
  expect(
    (await post(app, body, { timestamp: old, signature: `v1,${sign('msg_1', old, body)}` }))
      .statusCode,
  ).toBe(401);
  const otherKey = Buffer.alloc(32, 6);
  const now = String(Math.floor(Date.now() / 1000));
  expect(
    (
      await post(app, body, {
        timestamp: now,
        signature: `v1,${sign('msg_1', now, body, otherKey)}`,
      })
    ).statusCode,
  ).toBe(401);
});

test('a header with two signatures passes when the second one matches', async () => {
  const body = event('email.delivered', 're_z');
  const now = new Date('2026-10-29T12:00:00Z');
  const timestamp = String(now.getTime() / 1000);
  const good = sign('msg_2', timestamp, body);
  const check = (signature: string) =>
    validSvixSignature({
      id: 'msg_2',
      timestamp,
      signature,
      body: Buffer.from(body),
      secret: SECRET,
      now,
    });
  expect(check(`v1,${sign('msg_2', timestamp, body, Buffer.alloc(32, 1))} v1,${good}`)).toBe(true);
  expect(check(`v1,${sign('msg_2', timestamp, body, Buffer.alloc(32, 1))}`)).toBe(false);
  expect(check(`v2,${good}`)).toBe(false);
  expect(
    validSvixSignature({
      id: 'msg_2',
      timestamp,
      signature: `v1,${good}`,
      body: Buffer.from(body),
      secret: SECRET,
      now: new Date(now.getTime() + 301_000),
    }),
  ).toBe(false);

  const app = await setup();
  const live = String(Math.floor(Date.now() / 1000));
  const response = await post(app, body, {
    id: 'msg_2',
    timestamp: live,
    signature: `v1,wrong v1,${sign('msg_2', live, body)}`,
  });
  expect(response.statusCode).toBe(200);
});

test('a permanent bounce of an invoice e-mail blocks the address with reason bounce', async () => {
  const app = await setup({ ids: ['re_b1'] });
  await sendInvoiceMail(app);
  const response = await post(app, permanentBounce('re_b1'));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  expect(suppressions(app).reasonOf(CUSTOMER, 'invoice')).toBe('bounce');
  expect(rowOf(app, 're_b1')?.delivery).toBe('bounced');
});

test('a temporary bounce changes nothing', async () => {
  const app = await setup({ ids: ['re_t1'] });
  await sendInvoiceMail(app);
  const body = event('email.bounced', 're_t1', { bounce: { type: 'Transient' } });
  expect((await post(app, body)).statusCode).toBe(200);
  expect(suppressions(app).reasonOf(CUSTOMER, 'invoice')).toBeNull();
  expect(rowOf(app, 're_t1')?.delivery).toBeNull();
});

test('a complaint blocks with reason complaint and cancels pending invoice e-mail to the address', async () => {
  const app = await setup({ ids: ['re_c1'] });
  await sendInvoiceMail(app);
  const pending = app.app.mailOutbox.queue(
    {
      to: 'Cliente@Example.com',
      subject: 'Outra nota',
      html: '<p>nota</p>',
      text: 'nota',
      ref: { accountId: 'acc-1', invoiceId: 'inv-2' },
    },
    'invoice',
  );
  expect((await post(app, event('email.complained', 're_c1'))).statusCode).toBe(200);
  expect(suppressions(app).reasonOf(CUSTOMER, 'invoice')).toBe('complaint');
  expect(rowOf(app, 're_c1')?.delivery).toBe('complained');
  const queued = app.db.select().from(mailOutbox).where(eq(mailOutbox.id, pending)).get();
  expect(queued?.status).toBe('cancelled');
});

test('the same event twice answers 200 both times and leaves one active suppression row', async () => {
  const app = await setup({ ids: ['re_d1'] });
  await sendInvoiceMail(app);
  const body = permanentBounce('re_d1');
  expect((await post(app, body)).statusCode).toBe(200);
  expect((await post(app, body)).statusCode).toBe(200);
  const rows = app.db
    .select()
    .from(mailSuppressions)
    .where(eq(mailSuppressions.address, CUSTOMER))
    .all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.reason).toBe('bounce');
});

test('an unknown id and a login-code row answer 200 and add no suppression', async () => {
  const app = await setup({ ids: ['re_code'] });
  await app.app.mailOutbox.send(
    { to: CUSTOMER, subject: 'Código', html: '1', text: '1', kind: 'code' },
    'code',
  );
  expect((await post(app, permanentBounce('re_unknown'))).statusCode).toBe(200);
  expect((await post(app, event('email.complained', 're_code'))).statusCode).toBe(200);
  expect(suppressions(app).isSuppressed(CUSTOMER, 'invoice')).toBe(false);
});

test('a signed body that is not JSON, or lacks data.email_id, answers 400', async () => {
  const app = await setup();
  expect((await post(app, 'not json')).statusCode).toBe(400);
  expect((await post(app, JSON.stringify({ type: 'email.bounced', data: {} }))).statusCode).toBe(
    400,
  );
  expect((await post(app, JSON.stringify({ data: { email_id: 're_1' } }))).statusCode).toBe(400);
  expect((await post(app, 'null')).statusCode).toBe(400);
});

test('the metric counts applied and ignored events', async () => {
  const app = await setup({ ids: ['re_m1'] });
  await sendInvoiceMail(app);
  await post(app, permanentBounce('re_m1'));
  await post(app, permanentBounce('re_none'));
  await post(app, event('email.delivered', 're_m1'));
  const text = await app.app.metrics.render();
  expect(text).toContain('mail_webhook_events_total{type="email.bounced",outcome="applied"} 1');
  expect(text).toContain('mail_webhook_events_total{type="email.bounced",outcome="ignored"} 1');
  expect(text).toContain('mail_webhook_events_total{type="other",outcome="ignored"} 1');
});

test('the webhook writes no address and no body to the log', async () => {
  const lines: string[] = [];
  const ids = ['re_l1'];
  t = await createTestApp({
    env: { RESEND_WEBHOOK_SECRET: SECRET },
    mailId: () => ids.shift(),
    logStream: { write: (line) => lines.push(line) },
  });
  await sendInvoiceMail(t);
  lines.length = 0;
  expect((await post(t, permanentBounce('re_l1'))).statusCode).toBe(200);
  expect((await post(t, 'not json')).statusCode).toBe(400);
  const log = lines.join('\n');
  expect(log).not.toContain(CUSTOMER);
  expect(log).not.toContain('re_l1');
  expect(log).not.toContain('not json');
});
