import type { AccountContext } from '@notaflow/core';
import { type FakeNacional, startFakeNacional } from '@notaflow/fake-nacional';
import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cancelOnFake, issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { nacionalProviderFactory } from '../providers/providerFactory';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { sealCertificate } from '../vault/envelope';
import { VaultCertificateStore } from '../vault/VaultCertificateStore';
import { SyncBusyError, SyncService } from './SyncService';

const MASTER = Buffer.alloc(32, 5);
let fake: FakeNacional;
let db: Database;
let close: () => void;
let ctx: AccountContext;
let emitterId: string;
let service: SyncService;

beforeEach(async () => {
  fake = await startFakeNacional();
  ({ db, close } = openDatabase(':memory:'));
  ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  emitterId = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const cert = makeTestCertificate();
  const certificates = new CertificateRepository(db);
  certificates.addActive(
    ctx,
    emitterId,
    sealCertificate(cert.pfx, cert.password, MASTER, emitterId),
    {
      cnpj: cert.cnpj,
      subject: 'x',
      validFrom: new Date(),
      validTo: new Date(Date.now() + 86_400_000),
      fingerprintSha256: 'ab'.repeat(32),
      uploadedBy: ctx.userId,
    },
  );
  service = new SyncService({
    db,
    certificates: new VaultCertificateStore(certificates, MASTER),
    providerFactory: nacionalProviderFactory(fake.urls),
    retryDelaysMs: [0, 0],
  });
});
afterEach(async () => {
  close();
  await fake.close();
});

test('syncs every invoice and event, then a second run finds nothing new', async () => {
  const keys = await issueOnFake(fake, 3);
  await cancelOnFake(fake, keys[0] ?? '');
  const first = await service.syncEmitter(ctx, emitterId);
  expect(first).toMatchObject({
    environment: 'producao_restrita',
    invoices: 3,
    events: 1,
    lastNsu: 4,
    error: null,
  });
  const invoices = new InvoiceRepository(db).list(ctx, { limit: 10, offset: 0 });
  expect(invoices.total).toBe(3);
  expect(invoices.items.filter((i) => i.status === 'cancelled')).toHaveLength(1);
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({
    invoices: 0,
    events: 0,
    lastNsu: 4,
  });
});

test('walks more than one batch of 50', async () => {
  await issueOnFake(fake, 51);
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({ invoices: 51, lastNsu: 51 });
});

test('a 429 is retried, and after the last retry the error is recorded with the cursor kept', async () => {
  await issueOnFake(fake, 51);
  fake.next('dfe', { kind: 'reply', status: 429, body: {} });
  expect((await service.syncEmitter(ctx, emitterId)).error).toBeNull();

  await issueOnFake(fake, 1, 52);
  for (let i = 0; i < 3; i++) fake.next('dfe', { kind: 'reply', status: 429, body: {} });
  const failed = await service.syncEmitter(ctx, emitterId);
  expect(failed.error).toMatch(/429/);
  const state = new SyncStateRepository(db).get(ctx, emitterId, 'producao_restrita');
  expect(state).toMatchObject({ lastNsu: 51, lastError: expect.stringMatching(/429/) });
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({
    invoices: 1,
    lastNsu: 52,
    error: null,
  });
});

test('the cursor of producao does not reuse the cursor of producao_restrita', async () => {
  await issueOnFake(fake, 2);
  await service.syncEmitter(ctx, emitterId);
  new EmitterRepository(db).setEnvironment(ctx, emitterId, 'producao');
  const production = await service.syncEmitter(ctx, emitterId);
  // Read from NSU 0 again: reusing the restrita cursor (2) would fetch nothing.
  expect(production).toMatchObject({ environment: 'producao', invoices: 2, lastNsu: 2 });
  expect(new SyncStateRepository(db).get(ctx, emitterId, 'producao_restrita').lastNsu).toBe(2);
});

test('a second sync of the same emitter while one runs is refused', async () => {
  await issueOnFake(fake, 1);
  fake.next('dfe', { kind: 'delay', ms: 100 });
  const running = service.syncEmitter(ctx, emitterId);
  expect(service.isRunning(emitterId)).toBe(true);
  await expect(service.syncEmitter(ctx, emitterId)).rejects.toThrow(SyncBusyError);
  await running;
  expect(service.isRunning(emitterId)).toBe(false);
});
