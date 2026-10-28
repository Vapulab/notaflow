import { loadCertificate } from '@notaflow/signer-node';
import type { Database } from '../db/openDatabase';
import { CertificateRepository } from '../repos/CertificateRepository';
import { openLegacyCertificate, sealCertificate } from './envelope';

export interface ResealResult {
  resealed: number;
  // Certificate ids left at version 0: their PFX is not the emitter's, or it does not open.
  refused: string[];
}

// Runs at startup until no version 0 row is left; a row moved from another emitter fails the CNPJ check.
export function resealCertificates(db: Database, masterKey: Buffer): ResealResult {
  const certificates = new CertificateRepository(db);
  const result: ResealResult = { resealed: 0, refused: [] };
  for (const row of certificates.legacyActive()) {
    try {
      const { pfx, password } = openLegacyCertificate(row, masterKey);
      // An expired certificate is still resealed: the check is the CNPJ, not the dates.
      const { cnpj } = loadCertificate(pfx, password, new Date(row.validFrom.getTime() + 1));
      if (cnpj !== row.emitterCnpj) {
        result.refused.push(row.id);
        continue;
      }
      certificates.reseal(row.id, sealCertificate(pfx, password, masterKey, row.emitterId));
      result.resealed += 1;
    } catch {
      result.refused.push(row.id);
    }
  }
  return result;
}
