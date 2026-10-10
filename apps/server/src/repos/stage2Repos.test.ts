import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';
import { type ServiceInput, ServiceRepository } from './ServiceRepository';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  return { a, b, emitterId };
}

const service: ServiceInput = {
  name: 'Desenvolvimento',
  nationalTaxCode: '010701',
  nbsCode: '115080000',
  description: 'Desenvolvimento de software',
  pisCofinsCst: '00',
  ibsCbs: { operationCode: '100302', cst: '410', classCode: '410027' },
  export: {
    mode: '1',
    providerLink: '0',
    providerSupport: '02',
    customerSupport: '02',
    temporaryGoods: '1',
    mdic: '0',
  },
};

test('a new emitter has an empty fiscal configuration with the Simples regime inside the DAS', () => {
  const { a, emitterId } = setup();
  expect(new EmitterRepository(db).fiscalConfig(a, emitterId)).toEqual({
    simplesAnnex: null,
    simplesBand: null,
    simplesPercent: null,
    issRate: null,
    ibscbsRegime: 'inside_das',
    ibscbsRegimeFrom: null,
  });
});

test('the fiscal configuration round trips and stays in its account', () => {
  const { a, b, emitterId } = setup();
  const emitters = new EmitterRepository(db);
  const config = {
    simplesAnnex: 'III' as const,
    simplesBand: 2,
    simplesPercent: 1120,
    issRate: 200,
    ibscbsRegime: 'regular' as const,
    ibscbsRegimeFrom: '2027-01-01',
  };
  expect(emitters.setFiscalConfig(a, emitterId, config)).toBe(true);
  expect(emitters.fiscalConfig(a, emitterId)).toEqual(config);
  expect(emitters.fiscalConfig(b, emitterId)).toBeNull();
  expect(emitters.setFiscalConfig(b, emitterId, { ...config, issRate: 500 })).toBe(false);
  expect(emitters.fiscalConfig(a, emitterId)?.issRate).toBe(200);
});

test('a service is created, listed, updated, and archived out of the list', () => {
  const { a, emitterId } = setup();
  const services = new ServiceRepository(db);
  const created = services.create(a, emitterId, service);
  expect(created).toMatchObject({ ...service, emitterId, origin: 'manual', archived: false });
  expect(services.list(a, emitterId).map((s) => s.id)).toEqual([created.id]);

  expect(services.update(a, created.id, { ...service, name: 'Software' })).toBe(true);
  expect(services.get(a, created.id)?.name).toBe('Software');

  expect(services.setArchived(a, created.id, true)).toBe(true);
  expect(services.list(a, emitterId)).toEqual([]);
  expect(services.list(a, emitterId, { includeArchived: true })).toHaveLength(1);
});

test('a service without the optional groups reads back without them', () => {
  const { a, emitterId } = setup();
  const services = new ServiceRepository(db);
  const created = services.create(a, emitterId, {
    name: 'Consultoria',
    nationalTaxCode: '010101',
    description: 'Consultoria',
  });
  expect(services.get(a, created.id)).toEqual({
    id: created.id,
    emitterId,
    name: 'Consultoria',
    nationalTaxCode: '010101',
    description: 'Consultoria',
    origin: 'manual',
    archived: false,
  });
});

test('another account cannot see, change, or create services of the emitter', () => {
  const { a, b, emitterId } = setup();
  const services = new ServiceRepository(db);
  const created = services.create(a, emitterId, service);
  expect(services.get(b, created.id)).toBeNull();
  expect(services.list(b, emitterId)).toEqual([]);
  expect(services.update(b, created.id, { ...service, name: 'X' })).toBe(false);
  expect(services.setArchived(b, created.id, true)).toBe(false);
  expect(() => services.create(b, emitterId, service)).toThrow(/not found/);
});

test('a pending invoice keeps its built template and has no template_of', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: 'DPS411370021234567800019500900000000000000042',
    dpsSeries: '900',
    dpsNumber: 42,
    competence: '2026-10-31',
    serviceCents: 123400,
    description: 'Desenvolvimento de software',
    customerId: null,
    customerDocument: '11222333000181',
    customerName: 'Cliente Teste Ltda',
    serviceCode: '010701',
    environment: 'producao_restrita',
    templateOf: null,
    issueTemplate: '{"serviceCents":123400}',
    createdBy: a.userId,
  });
  expect(invoices.issueState(a, id)).toMatchObject({
    templateOf: null,
    issueTemplate: '{"serviceCents":123400}',
  });
});
