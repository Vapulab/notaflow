import { createHash } from 'node:crypto';
import type { CertificateMaterial } from '@notaflow/core';
import forge from 'node-forge';
import { CertificateError } from './CertificateError';

// PKCS#12 bag OIDs (RFC 7292); forge.pki.oids lookups are typed as possibly undefined.
const KEY_BAG = '1.2.840.113549.1.12.10.1.1';
const SHROUDED_KEY_BAG = '1.2.840.113549.1.12.10.1.2';
const CERT_BAG = '1.2.840.113549.1.12.10.1.3';

// Real files use 2048 or fewer; forge takes the count from the file and runs it on the event loop.
const MAX_ITERATIONS = 100_000;

type Kdf = (...args: unknown[]) => unknown;
// Each key derivation forge calls while it opens a file, with the position of its iteration count.
const KDFS: [Record<string, Kdf>, string, number][] = [
  [forge.pkcs12 as unknown as Record<string, Kdf>, 'generateKey', 3],
  [(forge.pki as unknown as { pbe: Record<string, Kdf> }).pbe, 'generatePkcs12Key', 3],
  [forge.pkcs5 as unknown as Record<string, Kdf>, 'pbkdf2', 2],
];

function withIterationCap<T>(run: () => T): T {
  const originals = KDFS.map(([owner, name]) => owner[name]);
  KDFS.forEach(([owner, name, at], i) => {
    const original = originals[i];
    if (!original) return;
    owner[name] = (...args: unknown[]) => {
      if (Number(args[at]) > MAX_ITERATIONS) throw new Error('Iteration count too high.');
      return original(...args);
    };
  });
  try {
    return run();
  } finally {
    KDFS.forEach(([owner, name], i) => {
      const original = originals[i];
      if (original) owner[name] = original;
    });
  }
}

// ICP-Brasil e-CNPJ certificates put "COMPANY NAME:CNPJ" in the CN.
const CN_CNPJ = /:([0-9A-Z]{14})$/;

export function loadCertificate(
  pfx: Buffer,
  password: string,
  now = new Date(),
): CertificateMaterial {
  const p12 = openPkcs12(pfx, password);

  const keyBags = [
    ...(p12.getBags({ bagType: SHROUDED_KEY_BAG })[SHROUDED_KEY_BAG] ?? []),
    ...(p12.getBags({ bagType: KEY_BAG })[KEY_BAG] ?? []),
  ];
  const key = keyBags.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key)
    throw new CertificateError('NO_PRIVATE_KEY', 'The certificate file has no private key.');

  // The file can carry the CA chain; pick the certificate that matches the key.
  const cert = (p12.getBags({ bagType: CERT_BAG })[CERT_BAG] ?? [])
    .map((bag) => bag.cert)
    .find((c) => c && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n));
  if (!cert) {
    throw new CertificateError(
      'NO_MATCHING_CERTIFICATE',
      'No certificate matches the private key.',
    );
  }

  const subject = cert.subject.attributes
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${String(a.value)}`)
    .join(', ');
  const commonName = String(cert.subject.getField('CN')?.value ?? '');
  const cnpj = CN_CNPJ.exec(commonName)?.[1];
  if (!cnpj) throw new CertificateError('CNPJ_NOT_FOUND', 'The certificate does not carry a CNPJ.');

  const { notBefore, notAfter } = cert.validity;
  if (now < notBefore) {
    throw new CertificateError(
      'NOT_YET_VALID',
      `The certificate is valid from ${notBefore.toISOString()}.`,
    );
  }
  if (now > notAfter) {
    throw new CertificateError('EXPIRED', `The certificate expired on ${notAfter.toISOString()}.`);
  }

  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');

  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certificatePem: forge.pki.certificateToPem(cert),
    cnpj,
    subject,
    notBefore,
    notAfter,
    fingerprintSha256: createHash('sha256').update(der).digest('hex'),
  };
}

function openPkcs12(pfx: Buffer, password: string): forge.pkcs12.Pkcs12Pfx {
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
  } catch {
    throw new CertificateError(
      'INVALID_FILE',
      'The file is not a valid PKCS#12 (.pfx) certificate.',
    );
  }
  try {
    return withIterationCap(() => forge.pkcs12.pkcs12FromAsn1(asn1, password));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/MAC could not be verified|Invalid password/i.test(message)) {
      throw new CertificateError('WRONG_PASSWORD', 'The certificate password is wrong.');
    }
    throw new CertificateError(
      'INVALID_FILE',
      'The file is not a valid PKCS#12 (.pfx) certificate.',
    );
  }
}
