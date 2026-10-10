import type { AccountContext } from '@notaflow/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { KEY, providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { CustomerRepository } from './CustomerRepository';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';
import { SyncStateRepository } from './SyncStateRepository';
import { SyncTargetRepository } from './SyncTargetRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let b: AccountContext;
let emitterId: string;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
});
afterEach(() => close());

function fixtureCustomer() {
  const party = providerInvoice().customer;
  if (!party) throw new Error('fixture has a customer');
  return party;
}

describe('CustomerRepository', () => {
  test('upserts by document and keeps fields edited by hand', () => {
    const customers = new CustomerRepository(db);
    const party = fixtureCustomer();
    const id = customers.upsertImported(a, emitterId, party);
    expect(id).toEqual(expect.any(String));
    customers.setManual(a, id ?? '', { email: 'manual@example.com' });
    const again = customers.upsertImported(a, emitterId, {
      ...party,
      name: 'Novo Nome',
      email: 'x@example.com',
    });
    expect(again).toBe(id);
    expect(customers.list(a, { emitterId })).toEqual([
      expect.objectContaining({
        name: 'Novo Nome',
        email: 'manual@example.com',
        origin: 'imported',
      }),
    ]);
  });

  test('a customer without a document is not stored', () => {
    expect(
      new CustomerRepository(db).upsertImported(a, emitterId, { document: null, name: 'X' }),
    ).toBeNull();
  });

  test('another account sees no customer and cannot upsert into this emitter', () => {
    const customers = new CustomerRepository(db);
    customers.upsertImported(a, emitterId, fixtureCustomer());
    expect(customers.list(b, {})).toEqual([]);
    expect(() => customers.upsertImported(b, emitterId, fixtureCustomer())).toThrow(/not found/);
  });
});

describe('InvoiceRepository', () => {
  test('upsertSynced creates once and updates on the second call', () => {
    const invoices = new InvoiceRepository(db);
    const first = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    const second = invoices.upsertSynced(a, emitterId, providerInvoice({ number: '43' }), null);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false, fromApp: false });
    expect(invoices.list(a, { limit: 50, offset: 0 })).toMatchObject({
      total: 1,
      items: [{ number: '43', status: 'issued' }],
    });
  });

  test('an event that arrives before its invoice makes the invoice cancelled on arrival', () => {
    const invoices = new InvoiceRepository(db);
    expect(invoices.recordEvent(a, emitterId, providerEvent())).toBe(true);
    expect(invoices.recordEvent(a, emitterId, providerEvent())).toBe(false);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.get(a, id)).toMatchObject({
      status: 'cancelled',
      events: [{ code: '101101', reasonCode: '1' }],
    });
  });

  test('a cancellation after the invoice cancels it, and a later re-sync keeps it cancelled', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    invoices.recordEvent(a, emitterId, providerEvent());
    invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.get(a, id)?.status).toBe('cancelled');
  });

  test.each(['105102', '105104', '305101'])(
    'event %s (substitution, granted analysis, ex officio) also cancels the invoice',
    (code) => {
      const invoices = new InvoiceRepository(db);
      const before = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
      invoices.recordEvent(a, emitterId, providerEvent({ code }));
      expect(invoices.get(a, before.id)?.status).toBe('cancelled');
    },
  );

  test('a substitution event that arrives before the invoice cancels it on arrival', () => {
    const invoices = new InvoiceRepository(db);
    invoices.recordEvent(a, emitterId, providerEvent({ code: '105102' }));
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.get(a, id)?.status).toBe('cancelled');
  });

  test('an event that does not cancel leaves the invoice issued', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    invoices.recordEvent(a, emitterId, providerEvent({ code: '101103' }));
    expect(invoices.get(a, id)?.status).toBe('issued');
  });

  test('findIdByAccessKey finds only an invoice of the account', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.findIdByAccessKey(a, KEY)).toBe(id);
    expect(invoices.findIdByAccessKey(b, KEY)).toBeNull();
  });

  test('stores and returns the official XML', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(
      a,
      emitterId,
      providerInvoice({ xml: '<NFSe>ção</NFSe>' }),
      null,
    );
    expect(invoices.xml(a, id)).toBe('<NFSe>ção</NFSe>');
    expect(invoices.xml(b, id)).toBeNull();
  });

  test('list filters by status, competence, and a search on number or customer name', () => {
    const invoices = new InvoiceRepository(db);
    invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    invoices.upsertSynced(
      a,
      emitterId,
      providerInvoice({
        accessKey: KEY.replace('0042', '0043'),
        number: '43',
        competence: '2026-08-31',
        customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Inc' },
      }),
      null,
    );
    expect(invoices.list(a, { competenceFrom: '2026-09-01', limit: 50, offset: 0 }).total).toBe(1);
    expect(
      invoices.list(a, { search: 'foreign', limit: 50, offset: 0 }).items.map((i) => i.number),
    ).toEqual(['43']);
    expect(invoices.list(a, { status: 'cancelled', limit: 50, offset: 0 }).total).toBe(0);
    expect(invoices.list(b, { limit: 50, offset: 0 }).total).toBe(0);
  });
});

describe('SyncStateRepository and SyncTargetRepository', () => {
  test('the cursor is kept per environment', () => {
    const state = new SyncStateRepository(db);
    expect(state.get(a, emitterId, 'producao_restrita').lastNsu).toBe(0);
    state.saveCursor(a, emitterId, 'producao_restrita', 12);
    expect(state.get(a, emitterId, 'producao_restrita').lastNsu).toBe(12);
    expect(state.get(a, emitterId, 'producao').lastNsu).toBe(0);
    state.recordRun(a, emitterId, 'producao_restrita', { at: new Date(), error: 'HTTP 429' });
    expect(state.get(a, emitterId, 'producao_restrita')).toMatchObject({
      lastNsu: 12,
      lastError: 'HTTP 429',
    });
  });

  test('the scheduler sees every emitter of every account', () => {
    expect(new SyncTargetRepository(db).list()).toEqual([
      { accountId: a.accountId, accountStatus: 'active', emitterId },
    ]);
  });
});
