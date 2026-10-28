import { randomBytes } from 'node:crypto';
import { makeTestCertificate } from '@notaflow/test-kit';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { openDatabase } from '../db/openDatabase';
import { certificates as certificatesTable } from '../db/schema';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { seal } from './envelope';
import { resealCertificates } from './resealCertificates';
import { VaultCertificateStore } from './VaultCertificateStore';

const master = Buffer.alloc(32, 5);

// The format before the AAD, as production rows hold it.
function legacySeal(pfx: Buffer, password: string) {
  const dataKey = randomBytes(32);
  return {
    pfxCiphertext: seal(pfx, dataKey),
    passwordCiphertext: seal(Buffer.from(password), dataKey),
    wrappedKey: seal(dataKey, master),
    sealVersion: 0,
  };
}

function setup() {
  const { db, close } = openDatabase(':memory:');
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitters = new EmitterRepository(db);
  const emitterFor = (cnpj: string) =>
    emitters.create(a, {
      cnpj,
      companyName: 'EMPRESA TESTE LTDA',
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    }).id;
  const certificates = new CertificateRepository(db);
  const store = (emitterId: string, cnpj: string) => {
    const cert = makeTestCertificate({ cnpj });
    return certificates.addActive(a, emitterId, legacySeal(cert.pfx, cert.password), {
      cnpj,
      subject: 'x',
      validFrom: new Date(),
      validTo: new Date(Date.now() + 86_400_000),
      fingerprintSha256: 'ab'.repeat(32),
      uploadedBy: a.userId,
    });
  };
  return { db, close, a, emitterFor, certificates, store };
}

test('the reseal binds each legacy certificate to its emitter, and the store then loads it', async () => {
  const { db, close, a, emitterFor, certificates, store } = setup();
  const emitterId = emitterFor('12345678000195');
  const id = store(emitterId, '12345678000195');
  const vault = new VaultCertificateStore(certificates, master);
  await expect(vault.loadActive(a, emitterId)).rejects.toThrow();

  expect(resealCertificates(db, master)).toEqual({ resealed: 1, refused: [] });
  const row = db.select().from(certificatesTable).where(eq(certificatesTable.id, id)).get();
  expect(row?.sealVersion).toBe(1);
  expect((await vault.loadActive(a, emitterId))?.cnpj).toBe('12345678000195');
  expect(resealCertificates(db, master)).toEqual({ resealed: 0, refused: [] });
  close();
});

test("a legacy certificate of another CNPJ in an emitter's row is refused, not resealed", () => {
  const { db, close, emitterFor, store } = setup();
  const emitterId = emitterFor('12345678000195');
  const id = store(emitterId, '11222333000181');
  expect(resealCertificates(db, master)).toEqual({ resealed: 0, refused: [id] });
  const row = db.select().from(certificatesTable).where(eq(certificatesTable.id, id)).get();
  expect(row?.sealVersion).toBe(0);
  close();
});
