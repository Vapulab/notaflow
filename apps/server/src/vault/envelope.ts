import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV = 12;
const TAG = 16;

// Version 1 binds each part to its emitter; version 0 rows only the startup reseal may open.
export const SEAL_VERSION = 1;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export interface SealedCertificate {
  pfxCiphertext: Buffer;
  passwordCiphertext: Buffer;
  wrappedKey: Buffer;
  sealVersion: number;
}

type Part = 'pfx' | 'password' | 'key';

// The AAD stops a database writer from moving one emitter's parts into another emitter's row.
const aadOf = (emitterId: string, part: Part) =>
  Buffer.from(`notaflow:certificate:${emitterId}:${part}`, 'utf8');

export function seal(plaintext: Buffer, key: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function open(sealed: Buffer, key: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < IV + TAG) throw new VaultError('Sealed data is too short.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
  } catch {
    // Never say which part failed: the key and a tampered blob look the same to a caller.
    throw new VaultError('Sealed data cannot be opened with this key.');
  }
}

export function sealCertificate(
  pfx: Buffer,
  password: string,
  masterKey: Buffer,
  emitterId: string,
): SealedCertificate {
  const dataKey = randomBytes(32);
  return {
    pfxCiphertext: seal(pfx, dataKey, aadOf(emitterId, 'pfx')),
    passwordCiphertext: seal(Buffer.from(password, 'utf8'), dataKey, aadOf(emitterId, 'password')),
    wrappedKey: seal(dataKey, masterKey, aadOf(emitterId, 'key')),
    sealVersion: SEAL_VERSION,
  };
}

export function openCertificate(
  sealed: SealedCertificate & { emitterId: string },
  masterKey: Buffer,
): { pfx: Buffer; password: string } {
  if (sealed.sealVersion !== SEAL_VERSION) {
    throw new VaultError('The certificate is not sealed to its emitter yet.');
  }
  const { emitterId } = sealed;
  const dataKey = open(sealed.wrappedKey, masterKey, aadOf(emitterId, 'key'));
  return {
    pfx: open(sealed.pfxCiphertext, dataKey, aadOf(emitterId, 'pfx')),
    password: open(sealed.passwordCiphertext, dataKey, aadOf(emitterId, 'password')).toString(
      'utf8',
    ),
  };
}

// Version 0 had no AAD; only the startup reseal calls this, and it checks the CNPJ before it trusts the result.
export function openLegacyCertificate(
  sealed: SealedCertificate,
  masterKey: Buffer,
): { pfx: Buffer; password: string } {
  const dataKey = open(sealed.wrappedKey, masterKey);
  return {
    pfx: open(sealed.pfxCiphertext, dataKey),
    password: open(sealed.passwordCiphertext, dataKey).toString('utf8'),
  };
}

export function rewrapKey(
  wrappedKey: Buffer,
  oldMasterKey: Buffer,
  newMasterKey: Buffer,
  emitterId: string,
): Buffer {
  const aad = aadOf(emitterId, 'key');
  return seal(open(wrappedKey, oldMasterKey, aad), newMasterKey, aad);
}
