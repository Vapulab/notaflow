import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted, touched } from '../db/stamps';
import { certificates, emitters } from '../db/schema';
import type { SealedCertificate } from '../vault/envelope';

export type CertificateRow = typeof certificates.$inferSelect;

export interface CertificateMeta {
  cnpj: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  fingerprintSha256: string;
  uploadedBy: string;
}

export class CertificateRepository {
  constructor(private readonly db: Database) {}

  addActive(
    ctx: AccountContext,
    emitterId: string,
    sealed: SealedCertificate,
    meta: CertificateMeta,
  ): string {
    return this.db.transaction((tx) => {
      const emitter = tx
        .select({ id: emitters.id })
        .from(emitters)
        .where(
          and(
            eq(emitters.id, emitterId),
            eq(emitters.accountId, ctx.accountId),
            notDeleted(emitters),
          ),
        )
        .get();
      if (!emitter) throw new Error('Emitter not found in this account.');
      // Crypto-shredding: the replaced certificate keeps its row, but its data key is destroyed.
      tx.update(certificates)
        .set({ active: false, wrappedKey: Buffer.alloc(0), ...touched(ctx) })
        .where(eq(certificates.emitterId, emitterId))
        .run();
      const id = randomUUID();
      tx.insert(certificates)
        .values({ ...created(ctx), id, emitterId, ...sealed, ...meta, active: true })
        .run();
      return id;
    });
  }

  // System-wide, for the startup reseal only: active certificates sealed before the AAD.
  legacyActive() {
    return this.db
      .select({
        id: certificates.id,
        emitterId: certificates.emitterId,
        emitterCnpj: emitters.cnpj,
        pfxCiphertext: certificates.pfxCiphertext,
        passwordCiphertext: certificates.passwordCiphertext,
        wrappedKey: certificates.wrappedKey,
        sealVersion: certificates.sealVersion,
        validFrom: certificates.validFrom,
      })
      .from(certificates)
      .innerJoin(emitters, eq(emitters.id, certificates.emitterId))
      .where(
        and(
          eq(certificates.sealVersion, 0),
          eq(certificates.active, true),
          notDeleted(emitters),
          notDeleted(certificates),
        ),
      )
      .all();
  }

  reseal(id: string, sealed: SealedCertificate): void {
    this.db
      .update(certificates)
      .set({ ...sealed, ...touched(null) })
      .where(and(eq(certificates.id, id), eq(certificates.sealVersion, 0)))
      .run();
  }

  activeFor(ctx: AccountContext, emitterId: string): CertificateRow | null {
    const row = this.db
      .select({ certificate: certificates })
      .from(certificates)
      .innerJoin(emitters, eq(emitters.id, certificates.emitterId))
      .where(
        and(
          eq(certificates.emitterId, emitterId),
          eq(certificates.active, true),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
          notDeleted(certificates),
        ),
      )
      .get();
    return row?.certificate ?? null;
  }
}
