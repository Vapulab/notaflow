import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { HttpError } from '../httpError';
import { nacionalProviderFactory } from '../providers/providerFactory';
import { loadConfig } from '../config';
import { EmitterOnboarding } from './EmitterOnboarding';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('a throw in the inTransaction hook leaves no emitter and no certificate', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'dono@example.com' });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    NACIONAL_FAKE_URL: t.fake.urls.sefin.replace('/SefinNacional', ''),
  });
  const service = new EmitterOnboarding({
    db: t.db,
    masterKey: config.masterKey,
    providerFactory: nacionalProviderFactory(config.nacionalUrls),
    onEmitterCreated: () => {},
  });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const attempt = service.create(
    a,
    'dono@example.com',
    {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '4113700',
      simplesNacional: '3',
      specialRegime: '0',
      dpsSeries: '900',
    },
    {
      inTransaction: () => {
        throw new HttpError(409, 'onboarding_step');
      },
    },
  );
  await expect(attempt).rejects.toMatchObject({ code: 'onboarding_step' });
  const count = (table: string) =>
    (t.db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  expect([count('emitters'), count('certificates')]).toEqual([0, 0]);
});
