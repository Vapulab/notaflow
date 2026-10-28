import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestCertificate } from '@notaflow/test-kit';
import forge from 'node-forge';
import { describe, expect, test } from 'vitest';
import { CertificateError, type CertificateErrorCode } from './CertificateError';
import { loadCertificate } from './loadCertificate';

function codeOf(run: () => unknown): CertificateErrorCode | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CertificateError) return error.code;
    throw error;
  }
  return undefined;
}

describe('loadCertificate', () => {
  test('loads a 3DES .pfx and reads CNPJ, dates, and fingerprint', () => {
    const cert = makeTestCertificate({ cnpj: '12345678000195' });
    const material = loadCertificate(cert.pfx, cert.password);
    expect(material.cnpj).toBe('12345678000195');
    expect(material.subject).toContain('EMPRESA TESTE LTDA:12345678000195');
    expect(material.privateKeyPem).toContain('PRIVATE KEY');
    expect(material.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(material.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

  // OpenSSL 3 refuses RC2-40 without -legacy, and many real e-CNPJ files use it.
  test.skipIf(!hasOpenssl)('loads a legacy RC2-40 .pfx built by openssl', () => {
    const cert = makeTestCertificate({ cnpj: '12345678000195' });
    const dir = mkdtempSync(join(tmpdir(), 'notaflow-rc2-'));
    try {
      writeFileSync(join(dir, 'key.pem'), cert.privateKeyPem);
      writeFileSync(join(dir, 'cert.pem'), cert.certificatePem);
      const pfxPath = join(dir, 'legacy.pfx');
      const pass = `pass:${cert.password}`;
      const run = (args: string[]) => {
        const result = spawnSync('openssl', args, { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        return `${result.stdout}${result.stderr}`;
      };
      run([
        'pkcs12',
        '-export',
        '-legacy',
        '-certpbe',
        'PBE-SHA1-RC2-40',
        '-keypbe',
        'PBE-SHA1-RC2-40',
        '-inkey',
        join(dir, 'key.pem'),
        '-in',
        join(dir, 'cert.pem'),
        '-out',
        pfxPath,
        '-passout',
        pass,
      ]);
      expect(
        run(['pkcs12', '-info', '-noout', '-legacy', '-in', pfxPath, '-passin', pass]),
      ).toContain('RC2');
      const material = loadCertificate(readFileSync(pfxPath), cert.password);
      expect(material.cnpj).toBe('12345678000195');
      expect(material.privateKeyPem).toContain('PRIVATE KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads an alphanumeric CNPJ', () => {
    const cert = makeTestCertificate({ cnpj: 'AB345678000195' });
    expect(loadCertificate(cert.pfx, cert.password).cnpj).toBe('AB345678000195');
  });

  test('rejects a wrong password with WRONG_PASSWORD', () => {
    const cert = makeTestCertificate();
    expect(codeOf(() => loadCertificate(cert.pfx, 'wrong'))).toBe('WRONG_PASSWORD');
  });

  test('rejects a file that is not PKCS#12 with INVALID_FILE', () => {
    expect(codeOf(() => loadCertificate(Buffer.from('not a certificate'), 'x'))).toBe(
      'INVALID_FILE',
    );
  });

  test('rejects an expired certificate with EXPIRED', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2019-01-01T00:00:00Z'),
      notAfter: new Date('2020-01-01T00:00:00Z'),
    });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('EXPIRED');
  });

  test('rejects a certificate that is not valid yet with NOT_YET_VALID', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2099-01-01T00:00:00Z'),
      notAfter: new Date('2100-01-01T00:00:00Z'),
    });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('NOT_YET_VALID');
  });

  test('rejects a CN without a CNPJ with CNPJ_NOT_FOUND', () => {
    const cert = makeTestCertificate({ cnpj: 'short' });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('CNPJ_NOT_FOUND');
  });
  // Without the cap, forge would run 2^31 rounds before it even checks the password.
  test('rejects a MAC iteration count above the cap with INVALID_FILE, fast', () => {
    const cert = makeTestCertificate();
    const pfx = forge.asn1.fromDer(forge.util.createBuffer(cert.pfx.toString('binary')));
    const macData = (pfx.value as forge.asn1.Asn1[])[2];
    const iterations = macData && (macData.value as forge.asn1.Asn1[])[2];
    if (!iterations) throw new Error('The test file has no MAC iteration count.');
    const withCount = (count: number) => {
      iterations.value = forge.asn1.integerToDer(count).getBytes();
      return Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary');
    };
    // A changed count under the cap breaks only the MAC.
    expect(codeOf(() => loadCertificate(withCount(3000), cert.password))).toBe('WRONG_PASSWORD');
    const started = Date.now();
    expect(codeOf(() => loadCertificate(withCount(0x7fffffff), cert.password))).toBe(
      'INVALID_FILE',
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(loadCertificate(cert.pfx, cert.password).cnpj).toBeTruthy();
  });
});
