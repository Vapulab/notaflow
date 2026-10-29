import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { postWebhook, WEBHOOK_SECRET } from '../../test/resendWebhookRequest';
import { COMPETENCE, withNewInvoiceSetup } from '../../test/newInvoiceSetup';
import { createTestApp, type TestApp } from '../../test/testApp';
import {
  auditLog,
  customers,
  emitters,
  invoices,
  mailOutbox,
  mailSuppressions,
} from '../db/schema';
import { signInvoiceUnsubscribe } from '../mail/invoiceUnsubscribe';
import type { HttpError } from '../httpError';
import { InvoiceMailer } from '../mail/InvoiceMailer';
import { MailOutbox } from '../mail/outbox';
import { MailSuppressionRepository } from '../repos/MailSuppressionRepository';

let t: TestApp;
let unsuppressed: string[] = [];
let unsuppressError: Error | null = null;
let resendOrigin: 'removed' | 'complaint' = 'removed';
let logLines: string[] = [];
const unsuppress = async (address: string) => {
  if (unsuppressError) throw unsuppressError;
  unsuppressed.push(address);
  return resendOrigin;
};
beforeEach(async () => {
  unsuppressed = [];
  unsuppressError = null;
  resendOrigin = 'removed';
  logLines = [];
  t = await createTestApp({ unsuppress, logStream: { write: (line) => logLines.push(line) } });
});
afterEach(() => t.close());

type Setup = Awaited<ReturnType<typeof withNewInvoiceSetup>>;

// New emitters start in produção restrita, where nothing is e-mailed by itself.
const production = () => t.db.update(emitters).set({ environment: 'producao' }).run();

const restricted = () => t.db.update(emitters).set({ environment: 'producao_restrita' }).run();

async function customerWithEmail(s: Setup, email: string): Promise<string> {
  const response = await s.call('POST', '/customers', {
    emitterId: s.emitterId,
    documentType: 'CNPJ',
    document: '45723174000110',
    name: 'Cliente Com Email Ltda',
    email,
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

async function issue(s: Setup, customerId: string, key?: string) {
  const response = await t.app.inject({
    method: 'POST',
    url: `${s.base}/invoices/new`,
    headers: { ...s.headers, ...(key ? { 'idempotency-key': key } : {}) },
    payload: {
      emitterId: s.emitterId,
      customerId,
      serviceId: s.serviceId,
      competence: COMPETENCE,
      serviceCents: 123400,
    },
  });
  expect([200, 201]).toContain(response.statusCode);
  return response.json<{ id: string; status: string }>();
}

const SECRET = 'test-secret-'.repeat(4);
const outbox = () => t.db.select().from(mailOutbox).where(eq(mailOutbox.kind, 'invoice')).all();

async function detail(s: Setup, id: string) {
  const response = await t.app.inject({
    method: 'GET',
    url: `${s.base}/invoices/${id}`,
    headers: s.headers,
  });
  return response.json<{
    customerEmail: string | null;
    customerEmailedAt: string | null;
    autoEmailCustomer: boolean;
    customerEmailProblem: { kind: 'invalid_address'; to: string } | null;
  }>();
}

const send = (s: Setup, id: string, to: string, options: { confirmAddress?: boolean } = {}) =>
  t.app.inject({
    method: 'POST',
    url: `${s.base}/invoices/${id}/email`,
    headers: s.headers,
    payload: { to, ...options },
  });

const mailerOf = () =>
  new InvoiceMailer({
    db: t.db,
    outbox: t.app.mailOutbox,
    appOrigin: 'http://localhost:3000',
    secret: SECRET,
    unsuppress,
  });
const ownerCtx = (s: Setup) => ({
  ...s.a,
  role: 'owner' as const,
  accountStatus: 'active' as const,
});

function seedSent(accountId: string, invoiceId: string, count: number, at: Date) {
  for (let i = 0; i < count; i += 1) {
    t.db
      .insert(mailOutbox)
      .values({
        kind: 'invoice',
        to: `old${i}@example.com`,
        subject: 's',
        html: '',
        text: '',
        status: 'sent',
        nextAttemptAt: at,
        createdAt: at,
        accountId,
        invoiceId,
      })
      .run();
  }
}

test('an app issue e-mails the customer once, with Reply-To the owner, and the detail shows when', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  const view = await issue(s, customerId);
  const rows = outbox();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    to: 'cliente@example.com',
    replyTo: 'owner@example.com',
    status: 'pending',
    accountId: s.a.accountId,
    invoiceId: view.id,
  });
  expect(rows[0]?.subject).toMatch(/^NFS-e nº \S+ de /);
  expect(rows[0]?.html).toMatch(/\/n\/[A-Za-z0-9_-]{43}/);
  await t.app.mailOutbox.deliverDue();
  expect(t.mail.filter((m) => m.to === 'cliente@example.com')).toHaveLength(1);
  const shown = await detail(s, view.id);
  expect(shown.customerEmailedAt).toEqual(expect.any(String));
  expect(shown.customerEmail).toBe('cliente@example.com');
});

test('an invoice of produção restrita is never e-mailed by itself', async () => {
  const s = await withNewInvoiceSetup(t);
  await restricted();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  await issue(s, customerId);
  expect(outbox()).toHaveLength(0);
});

test('a retried issue and a second call send one e-mail', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  const first = await issue(s, customerId, 'retry-invoice-key-1');
  const again = await issue(s, customerId, 'retry-invoice-key-1');
  expect(again.id).toBe(first.id);
  expect(mailerOf().sendAutomatic(ownerCtx(s), first.id)).toBe(false);
  expect(outbox()).toHaveLength(1);
});

test('nothing goes out with the setting off, without an address, or for a row that is not issued', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const withEmail = await customerWithEmail(s, 'cliente@example.com');
  t.db.update(emitters).set({ autoEmailCustomer: false }).run();
  await issue(s, withEmail);
  expect(outbox()).toHaveLength(0);
  t.db.update(emitters).set({ autoEmailCustomer: true }).run();
  const noAddress = await issue(s, s.brazilId);
  expect(outbox()).toHaveLength(0);
  expect(await detail(s, noAddress.id)).toMatchObject({
    customerEmail: null,
    customerEmailedAt: null,
    autoEmailCustomer: true,
  });
  const issued = await issue(s, withEmail);
  expect(outbox()).toHaveLength(1);
  t.db
    .update(invoices)
    .set({ status: 'rejected', customerEmailedAt: null })
    .where(eq(invoices.id, issued.id))
    .run();
  expect(mailerOf().sendAutomatic(ownerCtx(s), issued.id)).toBe(false);
  expect(outbox()).toHaveLength(1);
});

test('a synced invoice never gets the automatic e-mail', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  await issueExportOnFake(t.fake);
  await s.call('POST', `/emitters/${s.emitterId}/sync`, {});
  const list = (await s.call('GET', '/invoices')).json<{
    items: { id: string; origin: string }[];
  }>();
  const synced = list.items.find((i) => i.origin === 'synced');
  expect(synced).toBeDefined();
  expect(mailerOf().sendAutomatic(ownerCtx(s), synced?.id ?? '')).toBe(false);
  expect(outbox()).toHaveLength(0);
});

test('the address falls back to the customer record when the XML has none', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  expect((await detail(s, view.id)).customerEmail).toBeNull();
  t.db
    .update(customers)
    .set({ email: 'registro@example.com' })
    .where(eq(customers.id, s.brazilId))
    .run();
  expect((await detail(s, view.id)).customerEmail).toBe('registro@example.com');
});

test('a bad address counts as no address', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  t.db
    .update(customers)
    .set({ email: 'a@x.com; b@y.com' })
    .where(eq(customers.id, s.brazilId))
    .run();
  const view = await issue(s, s.brazilId);
  expect(outbox()).toHaveLength(0);
  expect((await detail(s, view.id)).customerEmail).toBeNull();
});

test('a member sends by hand: one e-mail to the typed address with Reply-To the sender', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const view = await issue(s, s.brazilId);
  const response = await send(s, view.id, 'outra@example.com');
  expect(response.statusCode).toBe(200);
  const sent = t.mail.filter((m) => m.to === 'outra@example.com');
  expect(sent).toHaveLength(1);
  expect(sent[0]?.replyTo).toBe('owner@example.com');
  expect(sent[0]?.text).toContain('/n/');
  expect(sent[0]?.subject).not.toContain('[TESTE]');
  expect(outbox()).toHaveLength(1);
  expect((await detail(s, view.id)).customerEmailedAt).toEqual(expect.any(String));
  expect((await send(s, view.id, 'not an address')).statusCode).toBe(400);
  expect((await send(s, view.id, 'a@x.com; b@y.com')).statusCode).toBe(400);
});

test('a hand send of a produção restrita invoice is marked as a test', async () => {
  const s = await withNewInvoiceSetup(t);
  await restricted();
  const view = await issue(s, s.brazilId);
  expect((await send(s, view.id, 'outra@example.com')).statusCode).toBe(200);
  const mail = t.mail.find((m) => m.to === 'outra@example.com');
  expect(mail?.subject).toMatch(/^\[TESTE\] NFS-e nº /);
  expect(mail?.text).toContain('Nota de teste (produção restrita), sem valor fiscal.');
  expect(mail?.html).toContain('Nota de teste (produção restrita), sem valor fiscal.');
});

test('the 51st e-mail of an account in an hour answers 429, also on a fresh instance', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  seedSent(s.a.accountId, 'other-invoice', 50, new Date());
  const blocked = await send(s, view.id, 'p51@example.com');
  expect(blocked.statusCode).toBe(429);
  expect(t.mail.filter((m) => m.to === 'p51@example.com')).toHaveLength(0);
  const fresh = new InvoiceMailer({
    db: t.db,
    outbox: new MailOutbox(
      t.db,
      async () => undefined,
      () => undefined,
    ),
    appOrigin: 'http://localhost:3000',
    secret: SECRET,
    unsuppress,
  });
  await expect(
    fresh.sendByHand(ownerCtx(s), view.id, 'p52@example.com', 'owner@example.com'),
  ).rejects.toMatchObject({ status: 429 } satisfies Partial<HttpError>);
});

test('mail older than an hour does not count against the account', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  seedSent(s.a.accountId, 'other-invoice', 50, new Date(Date.now() - 61 * 60_000));
  expect((await send(s, view.id, 'p@example.com')).statusCode).toBe(200);
});

test('the 6th e-mail of one invoice in a day answers 429, and the automatic one counts', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  const view = await issue(s, customerId);
  for (let i = 0; i < 4; i += 1) {
    expect((await send(s, view.id, `p${i}@example.com`)).statusCode).toBe(200);
  }
  expect((await send(s, view.id, 'p5@example.com')).statusCode).toBe(429);
  expect(outbox()).toHaveLength(5);
  t.db
    .update(mailOutbox)
    .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
    .run();
  expect((await send(s, view.id, 'p6@example.com')).statusCode).toBe(200);
});

test('the owner turns the automatic e-mail off and a member cannot', async () => {
  const s = await withNewInvoiceSetup(t);
  const url = `${s.base}/emitters/${s.emitterId}/settings`;
  const off = await s.call('PUT', `/emitters/${s.emitterId}/settings`, {
    autoEmailCustomer: false,
  });
  expect(off.statusCode).toBe(200);
  const list = (await s.call('GET', '/emitters')).json<{ autoEmailCustomer: boolean }[]>();
  expect(list[0]?.autoEmailCustomer).toBe(false);
  t.db.$client.prepare(`UPDATE memberships SET role = 'member'`).run();
  const denied = await t.app.inject({
    method: 'PUT',
    url,
    headers: s.headers,
    payload: { autoEmailCustomer: true },
  });
  expect(denied.statusCode).toBe(403);
});

const unsub = (address: string, token = signInvoiceUnsubscribe(address, SECRET)) =>
  `/nota/descadastrar?a=${encodeURIComponent(address)}&t=${token}`;

test('the invoice e-mail carries a signed unsubscribe link and the one-click headers', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  expect((await send(s, view.id, 'Cliente@Example.com')).statusCode).toBe(200);
  const mail = t.mail.find((m) => m.to === 'Cliente@Example.com');
  const url = `http://localhost:3000${unsub('cliente@example.com')}`;
  expect(mail?.headers).toEqual({
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  expect(mail?.text).toContain(url);
  expect(mail?.html).toContain(url.replace(/&/g, '&amp;'));
});

test('the unsubscribe page changes nothing; the POST records the address once', async () => {
  const path = unsub('cliente@example.com');
  const page = await t.app.inject({ url: path });
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('<form method="post"');
  expect(page.headers['x-robots-tag']).toBe('noindex');
  expect(t.db.select().from(mailSuppressions).all()).toHaveLength(0);
  for (let i = 0; i < 2; i += 1) {
    const post = await t.app.inject({
      method: 'POST',
      url: path,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(post.statusCode).toBe(200);
  }
  expect(t.db.select().from(mailSuppressions).all()).toMatchObject([
    { address: 'cliente@example.com', kind: 'invoice' },
  ]);
});

test('a bad signature, or a signature of another address, answers 400 and records nothing', async () => {
  const forged = unsub('cliente@example.com', signInvoiceUnsubscribe('outra@example.com', SECRET));
  for (const method of ['GET', 'POST'] as const) {
    expect((await t.app.inject({ method, url: forged })).statusCode).toBe(400);
    expect((await t.app.inject({ method, url: '/nota/descadastrar' })).statusCode).toBe(400);
  }
  expect(t.db.select().from(mailSuppressions).all()).toHaveLength(0);
});

test('a suppressed address gets no e-mail, and a manual send answers as a success', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  await t.app.inject({ method: 'POST', url: unsub('cliente@example.com') });
  const manual = await issue(s, s.brazilId);
  const blocked = await send(s, manual.id, 'CLIENTE@example.com');
  const fresh = await send(s, manual.id, 'novo@example.com');
  expect(blocked.statusCode).toBe(fresh.statusCode);
  expect(blocked.json()).toEqual(fresh.json());
  // Only the real send is queued, so only it counts against the caps.
  expect(outbox().map((r) => r.to)).toEqual(['novo@example.com']);
  const audited = t.db
    .select()
    .from(auditLog)
    .all()
    .map((r) => r.detail);
  expect(audited).toContain('manual suppressed @example.com');
  expect(t.mail.filter((m) => m.to.toLowerCase() === 'cliente@example.com')).toHaveLength(0);
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  await issue(s, customerId);
  expect(outbox()).toHaveLength(1);
});

test('a manual e-mail writes an audit row with the domain and never the address', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  await send(s, view.id, 'segredo@clientes.example.com');
  const rows = t.db
    .select()
    .from(auditLog)
    .all()
    .filter((r) => r.action === 'invoice.email');
  expect(rows).toMatchObject([
    {
      userEmail: 'owner@example.com',
      accountId: s.a.accountId,
      entity: view.id,
      result: 'ok',
      detail: 'manual @clientes.example.com',
    },
  ]);
  expect(JSON.stringify(rows)).not.toContain('segredo');
});

test('the 51st automatic e-mail of an account in an hour is skipped, the claim stays open, and an audit row has the domain', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  seedSent(s.a.accountId, 'other-invoice', 50, new Date(Date.now() - 60_000));
  const view = await issue(s, customerId);
  expect(outbox().filter((r) => r.invoiceId === view.id)).toHaveLength(0);
  expect((await detail(s, view.id)).customerEmailedAt).toBeNull();
  const rows = t.db
    .select()
    .from(auditLog)
    .all()
    .filter((r) => r.action === 'invoice.email');
  expect(rows).toMatchObject([
    { entity: view.id, result: 'refused', detail: 'automatic skipped, hourly limit @example.com' },
  ]);
  expect(JSON.stringify(rows)).not.toContain('cliente@');
});

test('an automatic e-mail still goes out at 49 sends in the hour', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  seedSent(s.a.accountId, 'other-invoice', 49, new Date(Date.now() - 60_000));
  const view = await issue(s, customerId);
  expect(outbox().filter((r) => r.invoiceId === view.id)).toHaveLength(1);
});

test('an unsubscribe cancels the invoice e-mail already queued to that address', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  await issue(s, customerId);
  expect(outbox()[0]?.status).toBe('pending');
  const response = await t.app.inject({
    method: 'POST',
    url: `/nota/descadastrar?a=cliente%40example.com&t=${signInvoiceUnsubscribe('cliente@example.com', SECRET)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'List-Unsubscribe=One-Click',
  });
  expect(response.statusCode).toBe(200);
  expect(outbox()[0]).toMatchObject({ status: 'cancelled', html: '', text: '' });
  await t.app.mailOutbox.deliverDue();
  expect(t.mail.filter((m) => m.to === 'cliente@example.com')).toHaveLength(0);
});

const blocks = () => new MailSuppressionRepository(t.db);
const audits = () =>
  t.db
    .select()
    .from(auditLog)
    .all()
    .filter((r) => r.action === 'invoice.email');

test('a send to a bounce-blocked address answers 409 email_invalid_address and queues nothing', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const response = await send(s, view.id, 'cliente@example.com');
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'email_invalid_address' });
  expect(outbox()).toHaveLength(0);
  expect(audits()).toHaveLength(0);
  expect(unsuppressed).toEqual([]);
});

test('the same address in other case or with spaces is blocked too', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add(' Cliente@Example.COM ', 'invoice', 'bounce');
  expect((await send(s, view.id, 'CLIENTE@example.com')).statusCode).toBe(409);
  await expect(
    mailerOf().sendByHand(ownerCtx(s), view.id, ' cliente@example.com ', 'owner@example.com'),
  ).rejects.toMatchObject({ status: 409, code: 'email_invalid_address' });
  expect(outbox()).toHaveLength(0);
});

test('confirmAddress unblocks, calls unsuppress once with the address, sends, and audits manual unblocked @example.com', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const response = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ sent: true });
  expect(unsuppressed).toEqual(['cliente@example.com']);
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBeNull();
  expect(t.mail.filter((m) => m.to === 'cliente@example.com')).toHaveLength(1);
  expect(audits()).toMatchObject([{ result: 'ok', detail: 'manual unblocked @example.com' }]);
  expect((await detail(s, view.id)).customerEmailedAt).toEqual(expect.any(String));
});

test('a second confirmAddress within 30 days answers 409 email_invalid_address_final', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const first = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(first.statusCode).toBe(200);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const again = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ error: 'email_invalid_address_final' });
  expect(unsuppressed).toEqual(['cliente@example.com']);
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBe('bounce');
  expect(outbox()).toHaveLength(1);
});

test('confirmAddress on an address Resend holds for a complaint sends nothing, answers like a send, and marks it a complaint', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  resendOrigin = 'complaint';
  const response = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ sent: true });
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBe('complaint');
  expect(outbox()).toHaveLength(0);
  expect(audits()).toMatchObject([{ result: 'ok', detail: 'manual suppressed @example.com' }]);
  // The guard was not spent: nothing was unblocked.
  expect(
    blocks().unblockedRecently('cliente@example.com', 'invoice', new Date(Date.now() - 86_400_000)),
  ).toBe(false);
  const again = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(again.json()).toEqual({ sent: true });
  expect(unsuppressed).toEqual(['cliente@example.com']);
  expect(outbox()).toHaveLength(0);
});

test('an unsuppress failure answers 502 email_unblock_failed and keeps the block', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  unsuppressError = new Error('Resend answered 500');
  const response = await send(s, view.id, 'cliente@example.com', { confirmAddress: true });
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'email_unblock_failed' });
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBe('bounce');
  expect(outbox()).toHaveLength(0);
  expect(audits().filter((r) => r.result === 'ok')).toHaveLength(0);
});

test('a failing unsuppress logs the status or the error class, never the address', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  unsuppressError = new Error('Resend answered 401');
  expect((await send(s, view.id, 'cliente@example.com', { confirmAddress: true })).statusCode).toBe(
    502,
  );
  unsuppressError = new TypeError(
    'fetch failed: https://api.resend.com/suppressions/cliente%40example.com',
  );
  expect((await send(s, view.id, 'cliente@example.com', { confirmAddress: true })).statusCode).toBe(
    502,
  );
  const failures = logLines.filter((line) => line.includes('Resend unsuppress failed'));
  expect(failures).toHaveLength(2);
  expect(failures[0]).toContain('Resend unsuppress failed: Resend answered 401');
  expect(failures[1]).toContain('Resend unsuppress failed: TypeError');
  expect(logLines.join('\n')).not.toMatch(/cliente(@|%40)example\.com/);
});

test('confirmAddress does not lift an unsubscribe or a complaint: the answer is sent and nothing is queued', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('saiu@example.com', 'invoice', 'unsubscribe');
  blocks().add('reclamou@example.com', 'invoice', 'complaint');
  for (const to of ['saiu@example.com', 'reclamou@example.com']) {
    const response = await send(s, view.id, to, { confirmAddress: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: true });
  }
  expect(outbox()).toHaveLength(0);
  expect(unsuppressed).toEqual([]);
  expect(blocks().reasonOf('saiu@example.com', 'invoice')).toBe('unsubscribe');
  expect(blocks().reasonOf('reclamou@example.com', 'invoice')).toBe('complaint');
});

test('a corrected address goes out normally while the old one stays blocked', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  expect((await send(s, view.id, 'cliente.certo@example.com')).statusCode).toBe(200);
  expect(outbox().map((r) => r.to)).toEqual(['cliente.certo@example.com']);
  expect(audits()).toMatchObject([{ detail: 'manual @example.com' }]);
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBe('bounce');
  expect((await send(s, view.id, 'cliente@example.com')).statusCode).toBe(409);
});

test('the automatic send to a bounce-blocked address records the block, and the detail shows customerEmailProblem with the address', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const view = await issue(s, customerId);
  expect(outbox()).toMatchObject([
    { to: 'cliente@example.com', invoiceId: view.id, status: 'cancelled', delivery: 'bounced' },
  ]);
  await t.app.mailOutbox.deliverDue();
  expect(t.mail.filter((m) => m.to === 'cliente@example.com')).toHaveLength(0);
  const shown = await detail(s, view.id);
  expect(shown.customerEmailProblem).toEqual({
    kind: 'invalid_address',
    to: 'cliente@example.com',
  });
  expect(shown.customerEmailedAt).toBeNull();
});

test('the automatic skip for a bounce-blocked address writes a refused audit row with the domain', async () => {
  const s = await withNewInvoiceSetup(t);
  await production();
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  blocks().add('cliente@example.com', 'invoice', 'bounce');
  const view = await issue(s, customerId);
  expect(audits()).toMatchObject([
    {
      userEmail: 'owner@example.com',
      accountId: s.a.accountId,
      entity: view.id,
      result: 'refused',
      detail: 'automatic skipped, address bounced @example.com',
    },
  ]);
  expect(JSON.stringify(audits())).not.toContain('cliente@');
});

test('a complaint on a login-code e-mail blocks invoice e-mail: a manual send answers as a success and queues nothing', async () => {
  await t.close();
  t = await createTestApp({
    unsuppress,
    env: { RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET },
    mailId: (message) =>
      message.kind === 'code' && message.to === 'cliente@example.com' ? 're_code' : undefined,
  });
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  await t.app.mailOutbox.send(
    { to: 'cliente@example.com', subject: 'Código', html: '1', text: '1', kind: 'code' },
    'code',
  );
  const complaint = JSON.stringify({
    type: 'email.complained',
    created_at: '2026-10-29T12:00:00.000Z',
    data: { email_id: 're_code', to: ['cliente@example.com'] },
  });
  expect((await postWebhook(t, complaint)).statusCode).toBe(200);
  expect(blocks().reasonOf('cliente@example.com', 'invoice')).toBe('complaint');
  const blocked = await send(s, view.id, 'cliente@example.com');
  const fresh = await send(s, view.id, 'novo@example.com');
  expect(blocked.statusCode).toBe(fresh.statusCode);
  expect(blocked.json()).toEqual(fresh.json());
  expect(outbox().map((r) => r.to)).toEqual(['novo@example.com']);
});

test('after a bounce webhook the detail shows customerEmailProblem; after a new successful send it is null', async () => {
  await t.close();
  const ids = ['re_first', 're_second'];
  t = await createTestApp({
    unsuppress,
    env: { RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET },
    mailId: (message) => (message.kind === 'invoice' ? ids.shift() : undefined),
  });
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  expect((await detail(s, view.id)).customerEmailProblem).toBeNull();
  expect((await send(s, view.id, 'cliente@example.com')).statusCode).toBe(200);
  const bounce = JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-10-29T12:00:00.000Z',
    data: {
      email_id: 're_first',
      to: ['cliente@example.com'],
      bounce: { type: 'Permanent', subType: 'General' },
    },
  });
  expect((await postWebhook(t, bounce)).statusCode).toBe(200);
  expect((await detail(s, view.id)).customerEmailProblem).toEqual({
    kind: 'invalid_address',
    to: 'cliente@example.com',
  });
  expect((await send(s, view.id, 'cliente.certo@example.com')).statusCode).toBe(200);
  expect((await detail(s, view.id)).customerEmailProblem).toBeNull();
});
