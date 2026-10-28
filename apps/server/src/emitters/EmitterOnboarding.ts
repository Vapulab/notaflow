import type { AccountContext, CertificateMaterial } from '@notaflow/core';
import { CertificateError, loadCertificate } from '@notaflow/signer-node';
import { municipality } from '../data/places';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { createRateLimiter } from '../rateLimit';
import type { ProviderFactory } from '../providers/providerFactory';
import { AuditLog } from '../repos/AuditLog';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { sealCertificate } from '../vault/envelope';

export interface NewEmitterInput {
  pfxBase64: string;
  password: string;
  municipality: string;
  municipalRegistration?: string;
  simplesNacional: '1' | '2' | '3';
  simplesRegime?: '1' | '2' | '3';
  specialRegime: string;
  dpsSeries: string;
  cnaes?: string[]; // from the CNPJ card, main first
}

export interface EmitterOnboardingDeps {
  db: Database;
  masterKey: Buffer;
  providerFactory: ProviderFactory;
  onEmitterCreated: (ctx: AccountContext, emitterId: string) => void;
}

// Opening a file costs CPU on the event loop, and a wrong password is a guess.
const openLimit = createRateLimiter({ windowMs: 10 * 60_000, max: 20 });

export function openPfx(
  ctx: AccountContext,
  pfxBase64: string,
  password: string,
): { pfx: Buffer; material: CertificateMaterial } {
  if (!openLimit(ctx.accountId)) throw new HttpError(429, 'too_many_certificate_attempts');
  const pfx = Buffer.from(pfxBase64, 'base64');
  try {
    return { pfx, material: loadCertificate(pfx, password) };
  } catch (error) {
    if (error instanceof CertificateError) throw new HttpError(400, error.code);
    throw error;
  }
}

// Creates an emitter from its certificate: checks, Sefin connection test, vault, and the first sync.
export class EmitterOnboarding {
  private readonly emitters: EmitterRepository;
  private readonly certificates: CertificateRepository;
  private readonly audit: AuditLog;

  constructor(private readonly deps: EmitterOnboardingDeps) {
    this.emitters = new EmitterRepository(deps.db);
    this.certificates = new CertificateRepository(deps.db);
    this.audit = new AuditLog(deps.db);
  }

  async create(
    ctx: AccountContext,
    actor: string,
    input: NewEmitterInput,
    // inTransaction runs with the emitter's insert: a throw there leaves no emitter.
    options: { expectedCnpj?: string; inTransaction?: () => void } = {},
  ) {
    const { emitters, certificates, audit, deps } = this;
    const { pfxBase64, password, cnaes, ...fiscal } = input;
    if (!municipality(fiscal.municipality)) throw new HttpError(400, 'unknown_municipality');
    const { pfx, material } = openPfx(ctx, pfxBase64, password);

    // The certificate proves the company: it must be the one of the CNPJ card.
    if (options.expectedCnpj && material.cnpj !== options.expectedCnpj) {
      audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action: 'emitter.create',
        entity: material.cnpj,
        result: 'refused',
        detail: 'certificate cnpj differs from the card',
      });
      throw new HttpError(409, 'certificate_cnpj_mismatch');
    }

    const refuseDuplicate = () => {
      if (emitters.isCnpjOfRemovedEmitter(ctx, material.cnpj)) {
        audit.record({
          userEmail: actor,
          accountId: ctx.accountId,
          action: 'emitter.create',
          entity: material.cnpj,
          result: 'refused',
          detail: 'cnpj of a removed emitter',
        });
        throw new HttpError(409, 'emitter_removed');
      }
      if (emitters.isCnpjTakenElsewhere(ctx, material.cnpj)) {
        audit.record({
          userEmail: actor,
          accountId: ctx.accountId,
          action: 'emitter.create',
          entity: material.cnpj,
          result: 'refused',
          detail: 'cnpj_in_other_account',
        });
        throw new HttpError(409, 'cnpj_in_other_account');
      }
      if (emitters.findByCnpj(ctx, material.cnpj)) throw new HttpError(409, 'emitter_exists');
    };
    refuseDuplicate();

    // Customers work in production only; produção restrita is a platform-admin tool.
    try {
      await deps
        .providerFactory({ environment: 'producao', certificate: material })
        .checkConnection(fiscal.municipality);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action: 'emitter.create',
        entity: material.cnpj,
        result: 'error',
        detail: `connection test: ${detail}`,
      });
      throw new HttpError(502, 'connection_test_failed', detail);
    }

    const create = () =>
      deps.db.transaction(() => {
        const created = emitters.create(ctx, {
          ...fiscal,
          environment: 'producao',
          cnpj: material.cnpj,
          companyName: companyNameOf(material),
          ...(cnaes && cnaes.length > 0 ? { cnaes: JSON.stringify(cnaes) } : {}),
        });
        const sealed = sealCertificate(pfx, password, deps.masterKey, created.id);
        certificates.addActive(ctx, created.id, sealed, {
          cnpj: material.cnpj,
          subject: material.subject,
          validFrom: material.notBefore,
          validTo: material.notAfter,
          fingerprintSha256: material.fingerprintSha256,
          uploadedBy: ctx.userId,
        });
        options.inTransaction?.();
        return created;
      });
    let emitter: ReturnType<typeof create>;
    try {
      emitter = create();
    } catch (error) {
      // Another request stored this CNPJ during the connection test: answer it like the first check.
      if (isUniqueViolation(error)) refuseDuplicate();
      throw error;
    }
    audit.record({
      userEmail: actor,
      accountId: ctx.accountId,
      action: 'emitter.create',
      entity: emitter.id,
      result: 'ok',
    });
    audit.record({
      userEmail: actor,
      accountId: ctx.accountId,
      action: 'certificate.upload',
      entity: emitter.id,
      result: 'ok',
    });
    deps.onEmitterCreated(ctx, emitter.id);
    return {
      id: emitter.id,
      cnpj: emitter.cnpj,
      companyName: emitter.companyName,
      environment: emitter.environment,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

// The e-CNPJ CN is "COMPANY NAME:CNPJ"; the name is the part before the last colon.
export function companyNameOf(material: CertificateMaterial): string {
  const cn = /CN=([^,]+)/.exec(material.subject)?.[1] ?? material.subject;
  const colon = cn.lastIndexOf(':');
  return colon > 0 ? cn.slice(0, colon) : cn;
}
