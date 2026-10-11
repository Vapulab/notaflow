import type { AccountContext } from '@notaflow/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { adminOf, seedTenant, seedUser } from '../../test/fixtures';
import { providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import {
  accounts,
  certificates,
  customers,
  emitters,
  invoices,
  memberships,
  services,
  users,
} from '../db/schema';
import { softDelete } from '../db/stamps';
import { AdminRepository } from './AdminRepository';
import { CertificateRepository } from './CertificateRepository';
import { CustomerRepository } from './CustomerRepository';
import { EmitterRepository } from './EmitterRepository';
import { IdentityRepository } from './IdentityRepository';
import { InvoiceRepository } from './InvoiceRepository';
import { MemberRepository } from './MemberRepository';
import { ServiceRepository } from './ServiceRepository';
import { SyncStateRepository } from './SyncStateRepository';
import { SyncTargetRepository } from './SyncTargetRepository';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function emitterFor(ctx: AccountContext, cnpj: string) {
  return new EmitterRepository(db).create(ctx, {
    cnpj,
    companyName: `EMPRESA ${cnpj}`,
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
}

test('a removed emitter disappears from every emitter read and keeps its CNPJ blocked', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const kept = emitterFor(a, '12345678000195');
  const gone = emitterFor(a, '11222333000181');
  expect(softDelete(db, emitters, gone, a)).toBe(true);
  const repo = new EmitterRepository(db);
  expect(repo.list(a).map((e) => e.id)).toEqual([kept]);
  expect(repo.get(a, gone)).toBeNull();
  expect(repo.findByCnpj(a, '11222333000181')).toBeNull();
  expect(repo.fiscalConfig(a, gone)).toBeNull();
  // Its invoices stay under the removed emitter, so the CNPJ waits for a platform admin to restore it.
  expect(repo.isCnpjOfRemovedEmitter(b, '11222333000181')).toBe(true);
  expect(repo.isCnpjOfRemovedEmitter(b, '12345678000195')).toBe(false);
  expect(repo.isCnpjTakenElsewhere(b, '11222333000181')).toBe(false);
  expect(new SyncTargetRepository(db).list().map((t) => t.emitterId)).not.toContain(gone);
});

test('a removed customer disappears, and the same document can come back', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const repo = new CustomerRepository(db);
  const party = { document: { type: 'CNPJ' as const, value: '11222333000181' }, name: 'Cliente' };
  const first = repo.upsertImported(a, emitterId, party) ?? '';
  softDelete(db, customers, first, a);
  expect(repo.get(a, first)).toBeNull();
  expect(repo.list(a, {})).toEqual([]);
  const second = repo.upsertImported(a, emitterId, party) ?? '';
  expect(second).not.toBe(first);
  expect(repo.list(a, {}).map((c) => c.id)).toEqual([second]);
});

test('a removed service disappears, and its import key can be imported again', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const repo = new ServiceRepository(db);
  const input = { name: 'S', nationalTaxCode: '010101', description: 'S' };
  repo.importService(a, emitterId, input, '010101|S');
  const [first] = repo.list(a, emitterId);
  softDelete(db, services, first?.id ?? '', a);
  expect(repo.get(a, first?.id ?? '')).toBeNull();
  expect(repo.list(a, emitterId, { includeArchived: true })).toEqual([]);
  repo.importService(a, emitterId, input, '010101|S');
  expect(repo.list(a, emitterId)).toHaveLength(1);
});

test('a removed invoice disappears from lists, lookups, and the issue state', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const repo = new InvoiceRepository(db);
  const { id } = repo.upsertSynced(a, emitterId, providerInvoice(), null);
  const pending = repo.createPending(a, {
    emitterId,
    dpsId: 'DPS1',
    dpsSeries: '900',
    dpsNumber: 99,
    competence: '2026-09-30',
    serviceCents: 100,
    description: 'X',
    customerId: null,
    customerDocument: null,
    customerName: null,
    serviceCode: '010101',
    environment: 'producao',
    templateOf: null,
    idempotencyKey: 'key-1',
  });
  softDelete(db, invoices, id, a);
  softDelete(db, invoices, pending, a);
  expect(repo.list(a, { limit: 10, offset: 0 }).total).toBe(0);
  expect(repo.get(a, id)).toBeNull();
  expect(repo.xml(a, id)).toBeNull();
  expect(repo.findIdByAccessKey(a, providerInvoice().accessKey)).toBeNull();
  expect(repo.findByIdempotencyKey(a, emitterId, 'key-1')).toBeNull();
  expect(repo.issueState(a, pending)).toBeNull();
  expect(repo.issueView(a, pending)).toBeNull();
});

test('the invoices of a removed emitter disappear with it', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const repo = new InvoiceRepository(db);
  const { id } = repo.upsertSynced(a, emitterId, providerInvoice(), null);
  softDelete(db, emitters, emitterId, a);
  expect(repo.list(a, { limit: 10, offset: 0 }).total).toBe(0);
  expect(repo.get(a, id)).toBeNull();
});

test('a removed membership, user, or account no longer gives access', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'a@example.com' });
  const identity = new IdentityRepository(db);
  expect(identity.findByEmail('a@example.com')?.memberships).toHaveLength(2);
  const membership = db.$client
    .prepare('SELECT id FROM memberships WHERE account_id = ?')
    .get(b.accountId) as { id: string };
  softDelete(db, memberships, membership.id, adminOf(a.userId));
  expect(identity.findByEmail('a@example.com')?.memberships.map((m) => m.accountId)).toEqual([
    a.accountId,
  ]);
  softDelete(db, accounts, a.accountId, adminOf(a.userId));
  expect(identity.findByEmail('a@example.com')?.memberships).toEqual([]);
  softDelete(db, users, a.userId, adminOf(a.userId));
  expect(identity.findByEmail('a@example.com')).toBeNull();
});

test('the admin and member lists skip removed rows, and a removed e-mail or membership can return', () => {
  const adminId = seedUser(db, 'admin@example.com', 'admin');
  const admin = new AdminRepository(db);
  const ctx = adminOf(adminId);
  const accountId = admin.createAccount(ctx, 'Conta');
  const userId = admin.createUser(ctx, 'pessoa@example.com', 'Pessoa') ?? '';
  admin.setMembership(ctx, accountId, userId, 'owner');
  const membership = db.$client
    .prepare('SELECT id FROM memberships WHERE user_id = ?')
    .get(userId) as { id: string };
  softDelete(db, memberships, membership.id, ctx);
  expect(admin.listAccounts(ctx).find((x) => x.id === accountId)?.members).toBe(0);
  const owner = {
    accountId,
    userId: adminId,
    role: 'owner' as const,
    accountStatus: 'active' as const,
  };
  expect(new MemberRepository(db).list(owner)).toEqual([]);
  expect(admin.setMembership(ctx, accountId, userId, 'member')).toBe(true);
  softDelete(db, users, userId, ctx);
  expect(admin.listUsers(ctx).map((u) => u.id)).not.toContain(userId);
  expect(admin.createUser(ctx, 'pessoa@example.com', 'Pessoa de novo')).not.toBeNull();
  softDelete(db, accounts, accountId, ctx);
  expect(admin.listAccounts(ctx).map((x) => x.id)).not.toContain(accountId);
});

test('a removed certificate is not the active one', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const repo = new CertificateRepository(db);
  const id = repo.addActive(
    a,
    emitterId,
    {
      pfxCiphertext: Buffer.from('x'),
      passwordCiphertext: Buffer.from('x'),
      wrappedKey: Buffer.from('x'),
    },
    {
      cnpj: '12345678000195',
      subject: 'CN=X',
      validFrom: new Date(),
      validTo: new Date(),
      fingerprintSha256: 'f',
      uploadedBy: a.userId,
    },
  );
  softDelete(db, certificates, id, a);
  expect(repo.activeFor(a, emitterId)).toBeNull();
});

test('admin updates and the seed ignore removed rows', async () => {
  const adminId = seedUser(db, 'admin@example.com', 'admin');
  const admin = new AdminRepository(db);
  const ctx = adminOf(adminId);
  const accountId = admin.createAccount(ctx, 'Conta');
  const userId = admin.createUser(ctx, 'pessoa@example.com', 'Pessoa') ?? '';
  softDelete(db, accounts, accountId, ctx);
  softDelete(db, users, userId, ctx);
  expect(admin.setAccountStatus(ctx, accountId, 'suspended')).toBe(false);
  expect(admin.setPlatformRole(ctx, userId, 'admin')).toBe(false);
  // The seed promotes the live user, never a removed one with the same e-mail.
  const live = admin.createUser(ctx, 'pessoa@example.com', 'Pessoa de novo') ?? '';
  const { seedAdmin } = await import('../seed');
  seedAdmin(db, 'pessoa@example.com', 'Pessoa');
  const role = (id: string) =>
    (
      db.$client.prepare('SELECT platform_role AS r FROM users WHERE id = ?').get(id) as {
        r: string;
      }
    ).r;
  expect(role(live)).toBe('admin');
  expect(role(userId)).toBe('user');
});

test('the sync cursor of a removed row is not read back', () => {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = emitterFor(a, '12345678000195');
  const state = new SyncStateRepository(db);
  state.saveCursor(a, emitterId, 'producao', 42);
  db.$client
    .prepare(
      "UPDATE sync_state SET deleted_at = 1 WHERE emitter_id = ? AND environment = 'producao'",
    )
    .run(emitterId);
  expect(state.get(a, emitterId, 'producao').lastNsu).toBe(0);
});
