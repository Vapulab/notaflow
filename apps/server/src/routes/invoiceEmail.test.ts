import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { COMPETENCE, withNewInvoiceSetup } from '../../test/newInvoiceSetup';
import { createTestApp, type TestApp } from '../../test/testApp';
import { customers, emitters, invoices, mailOutbox } from '../db/schema';
import { InvoiceMailer } from '../mail/InvoiceMailer';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

type Setup = Awaited<ReturnType<typeof withNewInvoiceSetup>>;

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
  }>();
}

const send = (s: Setup, id: string, to: string) =>
  t.app.inject({
    method: 'POST',
    url: `${s.base}/invoices/${id}/email`,
    headers: s.headers,
    payload: { to },
  });

const mailerOf = () =>
  new InvoiceMailer({
    db: t.db,
    outbox: t.app.mailOutbox,
    appOrigin: 'http://localhost:3000',
  });
const ownerCtx = (s: Setup) => ({
  ...s.a,
  role: 'owner' as const,
  accountStatus: 'active' as const,
});

test('an app issue e-mails the customer once, with Reply-To the owner, and the detail shows when', async () => {
  const s = await withNewInvoiceSetup(t);
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  const view = await issue(s, customerId);
  const rows = outbox();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    to: 'cliente@example.com',
    replyTo: 'owner@example.com',
    status: 'pending',
  });
  expect(rows[0]?.subject).toMatch(/^NFS-e nº \S+ de /);
  expect(rows[0]?.html).toMatch(/\/n\/[A-Za-z0-9_-]{43}/);
  await t.app.mailOutbox.deliverDue();
  expect(t.mail.filter((m) => m.to === 'cliente@example.com')).toHaveLength(1);
  const shown = await detail(s, view.id);
  expect(shown.customerEmailedAt).toEqual(expect.any(String));
  expect(shown.customerEmail).toBe('cliente@example.com');
});

test('a retried issue and a second call send one e-mail', async () => {
  const s = await withNewInvoiceSetup(t);
  const customerId = await customerWithEmail(s, 'cliente@example.com');
  const first = await issue(s, customerId, 'retry-invoice-key-1');
  const again = await issue(s, customerId, 'retry-invoice-key-1');
  expect(again.id).toBe(first.id);
  expect(mailerOf().sendAutomatic(ownerCtx(s), first.id)).toBe(false);
  expect(outbox()).toHaveLength(1);
});

test('nothing goes out with the setting off, without an address, or for a row that is not issued', async () => {
  const s = await withNewInvoiceSetup(t);
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

test('a member sends by hand: one e-mail to the typed address with Reply-To the sender', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  const response = await send(s, view.id, 'outra@example.com');
  expect(response.statusCode).toBe(200);
  const sent = t.mail.filter((m) => m.to === 'outra@example.com');
  expect(sent).toHaveLength(1);
  expect(sent[0]?.replyTo).toBe('owner@example.com');
  expect(sent[0]?.text).toContain('/n/');
  expect(outbox()).toHaveLength(1);
  expect((await detail(s, view.id)).customerEmailedAt).toEqual(expect.any(String));
  expect((await send(s, view.id, 'not an address')).statusCode).toBe(400);
});

test('the 51st e-mail of an account in an hour answers 429', async () => {
  const s = await withNewInvoiceSetup(t);
  const view = await issue(s, s.brazilId);
  for (let i = 0; i < 50; i += 1) {
    expect((await send(s, view.id, `p${i}@example.com`)).statusCode).toBe(200);
  }
  const blocked = await send(s, view.id, 'p51@example.com');
  expect(blocked.statusCode).toBe(429);
  expect(t.mail.filter((m) => m.to === 'p51@example.com')).toHaveLength(0);
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
