import { makeTestCertificate } from '@notaflow/test-kit';
import { expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { openDatabase } from '../db/openDatabase';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { certificates as certificatesTable } from '../db/schema';
import { openCertificate, sealCertificate, VaultError } from './envelope';
import { VaultCertificateStore } from './VaultCertificateStore';

const master = Buffer.alloc(32, 3);

test('loads the active certificate as PEM material, only for its own account', async () => {
  const { db, close } = openDatabase(':memory:');
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const emitter = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const testCert = makeTestCertificate();
  const certificates = new CertificateRepository(db);
  certificates.addActive(a, emitter.id, sealCertificate(testCert.pfx, testCert.password, master), {
    cnpj: testCert.cnpj,
    subject: 'x',
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86_400_000),
    fingerprintSha256: 'ab'.repeat(32),
    uploadedBy: a.userId,
  });

  const store = new VaultCertificateStore(certificates, master);
  expect((await store.loadActive(a, emitter.id))?.cnpj).toBe('12345678000195');
  expect(await store.loadActive(b, emitter.id)).toBeNull();
  await expect(
    new VaultCertificateStore(certificates, Buffer.alloc(32, 4)).loadActive(a, emitter.id),
  ).rejects.toThrow(VaultError);
  close();
});

test('a replaced certificate loses the key that decrypts it, so no one can read it again', () => {
  const { db, close } = openDatabase(':memory:');
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitter = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const testCert = makeTestCertificate();
  const meta = {
    cnpj: testCert.cnpj,
    subject: 'x',
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86_400_000),
    fingerprintSha256: 'ab'.repeat(32),
    uploadedBy: a.userId,
  };
  const certificates = new CertificateRepository(db);
  const seal = () => sealCertificate(testCert.pfx, testCert.password, master);
  const first = certificates.addActive(a, emitter.id, seal(), meta);
  certificates.addActive(a, emitter.id, seal(), meta);
  const rows = db.select().from(certificatesTable).all();
  const old = rows.find((row) => row.id === first);
  expect(old?.active).toBe(false);
  expect(old?.wrappedKey.length).toBe(0);
  expect(() =>
    openCertificate(
      {
        pfxCiphertext: old?.pfxCiphertext ?? Buffer.alloc(0),
        passwordCiphertext: old?.passwordCiphertext ?? Buffer.alloc(0),
        wrappedKey: old?.wrappedKey ?? Buffer.alloc(0),
      },
      master,
    ),
  ).toThrow();
  expect(rows.find((row) => row.id !== first)?.wrappedKey.length).toBeGreaterThan(0);
  close();
});
