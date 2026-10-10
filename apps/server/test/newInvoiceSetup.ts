import { makeTestCertificate } from '@notaflow/test-kit';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { accounts, memberships } from '../src/db/schema';
import { InvoiceRepository } from '../src/repos/InvoiceRepository';
import { seedTenant } from './fixtures';
import type { TestApp } from './testApp';

export const COMPETENCE = '2026-10-01';

// An onboarded emitter with a fiscal configuration, one service, and a Brazil and a foreign customer.
export async function withNewInvoiceSetup(
  t: TestApp,
  options: {
    fiscal?: boolean;
    email?: string;
    role?: 'owner' | 'member';
    status?: 'active' | 'suspended';
    simplesNacional?: '1' | '2' | '3';
    cnpj?: string;
    accountName?: string;
  } = {},
) {
  const email = options.email ?? 'owner@example.com';
  // Onboarding and setup need an owner of an active account; the role and status apply after.
  const a = seedTenant(t.db, { accountName: options.accountName ?? 'A', email });
  const cert = makeTestCertificate({ cnpj: options.cnpj ?? '12345678000195' });
  const headers = await t.as(email);
  const base = `/api/accounts/${a.accountId}`;
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url: `${base}${url}`, headers, ...(payload ? { payload } : {}) });

  const onboard = await call('POST', '/emitters', {
    pfxBase64: cert.pfx.toString('base64'),
    password: cert.password,
    municipality: '4113700',
    simplesNacional: options.simplesNacional ?? '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  expect(onboard.statusCode).toBe(201);
  const emitterId = onboard.json<{ id: string }>().id;
  if (options.fiscal !== false) {
    const fiscal = await call('PUT', `/emitters/${emitterId}/fiscal`, {
      simplesAnnex: 'III',
      simplesBand: 1,
      issRate: 200,
      ibscbsRegime: 'inside_das',
    });
    expect(fiscal.statusCode).toBe(200);
  }
  const service = await call('POST', `/emitters/${emitterId}/services`, {
    name: 'Desenvolvimento',
    nationalTaxCode: '010101',
    nbsCode: '115080000',
    description: 'Desenvolvimento de software',
    pisCofinsCst: '00',
    ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
  });
  expect(service.statusCode).toBe(201);
  const brazil = await call('POST', '/customers', {
    emitterId,
    documentType: 'CNPJ',
    document: '11222333000181',
    name: 'Cliente Teste Ltda',
    address: {
      kind: 'domestic',
      municipality: '4113700',
      zip: '86010000',
      street: 'Rua Teste',
      number: '1',
      district: 'Centro',
    },
  });
  const abroad = await call('POST', '/customers', {
    emitterId,
    documentType: 'NIF',
    document: '00-0000000',
    name: 'Foreign Customer Inc',
    address: {
      kind: 'foreign',
      country: 'US',
      postalCode: '99999',
      city: 'Testville',
      region: 'NY',
      street: '1 Example Street',
      number: '1',
      district: 'Downtown',
    },
  });
  if (options.role) {
    t.db
      .update(memberships)
      .set({ role: options.role })
      .where(eq(memberships.accountId, a.accountId))
      .run();
  }
  if (options.status) {
    t.db.update(accounts).set({ status: options.status }).where(eq(accounts.id, a.accountId)).run();
  }
  return {
    a,
    base,
    headers,
    call,
    emitterId,
    serviceId: service.json<{ id: string }>().id,
    brazilId: brazil.json<{ id: string }>().id,
    abroadId: abroad.json<{ id: string }>().id,
  };
}

export function xmlOf(
  t: TestApp,
  a: { accountId: string; userId: string },
  invoiceId: string,
): string {
  return (
    new InvoiceRepository(t.db).xml({ ...a, role: 'owner', accountStatus: 'active' }, invoiceId) ??
    ''
  );
}
