import type { AccountContext } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { accounts, emitters, invoiceLinks, invoices } from '../db/schema';
import { softDelete } from '../db/stamps';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceLinkRepository } from './InvoiceLinkRepository';
import { InvoiceRepository } from './InvoiceRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let emitterId: string;
let invoiceId: string;
let repo: InvoiceLinkRepository;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  invoiceId = new InvoiceRepository(db).upsertSynced(a, emitterId, providerInvoice(), null).id;
  repo = new InvoiceLinkRepository(db);
});
afterEach(() => close());

describe('InvoiceLinkRepository', () => {
  test('creates the link once and then returns the same token', () => {
    const token = repo.linkFor(a, invoiceId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.linkFor(a, invoiceId)).toBe(token);
  });

  test('another account gets not found', () => {
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    expect(() => repo.linkFor(b, invoiceId)).toThrow(/not found/i);
    expect(repo.revoke(b, invoiceId)).toBe(false);
  });

  test('revoke hides the view and a new link gets a new token', () => {
    const token = repo.linkFor(a, invoiceId);
    expect(repo.revoke(a, invoiceId)).toBe(true);
    expect(repo.revoke(a, invoiceId)).toBe(false);
    expect(repo.publicView(token)).toBeNull();
    const next = repo.linkFor(a, invoiceId);
    expect(next).not.toBe(token);
    expect(repo.publicView(next)?.invoiceId).toBe(invoiceId);
  });

  test('the view carries the public fields and the event codes', () => {
    const token = repo.linkFor(a, invoiceId);
    new InvoiceRepository(db).recordEvent(a, emitterId, providerEvent());
    const view = repo.publicView(token);
    expect(view).toMatchObject({
      invoiceId,
      emitterName: 'EMPRESA TESTE LTDA',
      number: '42',
      netCents: 147000,
      environment: 'producao_restrita',
      eventCodes: ['101101'],
    });
    expect(view?.issuedAt).toEqual(new Date('2026-10-01T13:00:00Z'));
  });

  test('the view has no customer field or value', () => {
    const view = repo.publicView(repo.linkFor(a, invoiceId));
    const text = JSON.stringify(view);
    expect(Object.keys(view ?? {}).some((k) => /customer|tomador/i.test(k))).toBe(false);
    expect(text).not.toContain('Cliente Exemplo');
    expect(text).not.toContain('98765432000110');
    expect(text).not.toContain('financeiro@example.com');
  });

  test('an unknown token gives null', () => {
    expect(repo.publicView('nope')).toBeNull();
  });

  test('a soft-deleted invoice, emitter, or account gives null', () => {
    const token = repo.linkFor(a, invoiceId);
    softDelete(db, invoices, invoiceId, a);
    expect(repo.publicView(token)).toBeNull();
    db.update(invoices).set({ deletedAt: null }).where(eq(invoices.id, invoiceId)).run();
    softDelete(db, emitters, emitterId, a);
    expect(repo.publicView(token)).toBeNull();
    db.update(emitters).set({ deletedAt: null }).where(eq(emitters.id, emitterId)).run();
    expect(repo.publicView(token)).not.toBeNull();
    softDelete(db, accounts, a.accountId, a);
    expect(repo.publicView(token)).toBeNull();
  });

  test('a suspended account still serves the view', () => {
    const token = repo.linkFor(a, invoiceId);
    db.update(accounts).set({ status: 'suspended' }).where(eq(accounts.id, a.accountId)).run();
    expect(repo.publicView(token)).not.toBeNull();
  });

  test('countView adds one per call and ignores a revoked token', () => {
    const token = repo.linkFor(a, invoiceId);
    repo.countView(token);
    repo.countView(token);
    expect(db.select().from(invoiceLinks).get()?.views).toBe(2);
    repo.revoke(a, invoiceId);
    repo.countView(token);
    expect(db.select().from(invoiceLinks).get()?.views).toBe(2);
  });
});
