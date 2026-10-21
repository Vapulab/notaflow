import { afterEach, beforeEach, expect, test } from 'vitest';
import { adminOf, seedTenant, seedUser } from '../../test/fixtures';
import { providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { AdminRepository } from './AdminRepository';
import { CustomerRepository } from './CustomerRepository';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';
import { ServiceRepository } from './ServiceRepository';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

type Stamp = {
  created_by: string | null;
  updated_by: string | null;
  created_at: number | null;
  updated_at: number | null;
};

function stampOf(table: string, id: string): Stamp {
  return db.$client
    .prepare(`SELECT created_by, updated_by, created_at, updated_at FROM ${table} WHERE id = ?`)
    .get(id) as Stamp;
}

function setup() {
  const ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitter = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  return { ctx, emitterId: emitter.id, system: { ...ctx, userId: 'system' } };
}

test('an account context creates rows in its own name', () => {
  const { ctx, emitterId } = setup();
  expect(stampOf('emitters', emitterId)).toMatchObject({
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  const service = new ServiceRepository(db).create(ctx, emitterId, {
    name: 'S',
    nationalTaxCode: '010101',
    description: 'S',
  });
  expect(stampOf('services', service.id).created_by).toBe(ctx.userId);
  const customer = new CustomerRepository(db).createManual(ctx, emitterId, {
    documentType: 'NIF',
    document: '00-1',
    name: 'C',
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '1',
      city: 'X',
      region: 'Y',
      street: 'S',
      number: '1',
      district: 'D',
    },
  });
  expect(customer && stampOf('customers', customer.id).created_by).toBe(ctx.userId);
});

test('an update names its actor and moves updated_at', async () => {
  const { ctx, emitterId } = setup();
  const other = seedUser(db, 'b@example.com');
  const otherCtx = { ...ctx, userId: other };
  const services = new ServiceRepository(db);
  const service = services.create(ctx, emitterId, {
    name: 'S',
    nationalTaxCode: '010101',
    description: 'S',
  });
  const before = stampOf('services', service.id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  services.setArchived(otherCtx, service.id, true);
  const after = stampOf('services', service.id);
  expect(after.updated_by).toBe(other);
  expect(after.created_by).toBe(ctx.userId);
  expect(after.updated_at).toBeGreaterThan(before.updated_at ?? 0);
  new EmitterRepository(db).setFiscalConfig(otherCtx, emitterId, {
    simplesAnnex: 'III',
    simplesBand: 1,
    simplesPercent: 600,
    simplesRbt12Cents: null,
    simplesRbt12At: null,
    simplesBand6Iss: null,
    issRate: 200,
    ibscbsRegime: 'inside_das',
    ibscbsRegimeFrom: null,
  });
  expect(stampOf('emitters', emitterId).updated_by).toBe(other);
});

test('the sync writes as the system, stored as null', () => {
  const { emitterId, system } = setup();
  const invoices = new InvoiceRepository(db);
  const row = invoices.upsertSynced(system, emitterId, providerInvoice(), null);
  expect(stampOf('invoices', row.id)).toMatchObject({ created_by: null, updated_by: null });
  const customerId = new CustomerRepository(db).upsertImported(system, emitterId, {
    document: { type: 'CNPJ', value: '11222333000181' },
    name: 'Cliente',
  });
  expect(stampOf('customers', customerId ?? '').created_by).toBeNull();
});

test('a platform admin creates accounts and users in its own name', () => {
  const adminId = seedUser(db, 'admin@example.com', 'admin');
  const admin = new AdminRepository(db);
  const accountId = admin.createAccount(adminOf(adminId), 'Nova');
  expect(stampOf('accounts', accountId).created_by).toBe(adminId);
  const userId = admin.createUser(adminOf(adminId), 'novo@example.com', 'Novo');
  expect(userId && stampOf('users', userId).created_by).toBe(adminId);
});
