import type { AccountContext } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { ProviderFactory } from '../providers/providerFactory';
import { AuditLog } from '../repos/AuditLog';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { sealCertificate } from '../vault/envelope';
import { EmitterOnboarding, openPfx } from '../emitters/EmitterOnboarding';
import { OnboardingRepository } from '../repos/OnboardingRepository';

const DAY_MS = 86_400_000;

interface OnboardBody {
  pfxBase64: string;
  password: string;
  municipality: string;
  municipalRegistration?: string;
  simplesNacional: '1' | '2' | '3';
  simplesRegime?: '1' | '2' | '3';
  specialRegime: string;
  dpsSeries: string;
}

const onboardSchema = {
  body: {
    type: 'object',
    required: [
      'pfxBase64',
      'password',
      'municipality',
      'simplesNacional',
      'specialRegime',
      'dpsSeries',
    ],
    additionalProperties: false,
    properties: {
      pfxBase64: { type: 'string', minLength: 1, maxLength: 200_000 },
      password: { type: 'string', maxLength: 200 },
      municipality: { type: 'string', pattern: '^[0-9]{7}$' },
      municipalRegistration: { type: 'string', minLength: 1, maxLength: 15 },
      simplesNacional: { enum: ['1', '2', '3'] },
      simplesRegime: { enum: ['1', '2', '3'] },
      specialRegime: { enum: ['0', '1', '2', '3', '4', '5', '6', '9'] },
      dpsSeries: { type: 'string', pattern: '^[0-9]{1,5}$' },
    },
  },
} as const;

export function emitterRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    masterKey: Buffer;
    providerFactory: ProviderFactory;
    onEmitterCreated: (ctx: AccountContext, emitterId: string) => void;
  },
): void {
  const onboarding = new EmitterOnboarding(deps);
  const steps = new OnboardingRepository(deps.db);
  const emitters = new EmitterRepository(deps.db);
  const certificates = new CertificateRepository(deps.db);
  const audit = new AuditLog(deps.db);

  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/emitters',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      return emitters.list(ctx).map((emitter) => {
        const certificate = certificates.activeFor(ctx, emitter.id);
        return {
          id: emitter.id,
          cnpj: emitter.cnpj,
          companyName: emitter.companyName,
          environment: emitter.environment,
          municipality: emitter.municipality,
          dpsSeries: emitter.dpsSeries,
          certificate: certificate
            ? {
                validTo: certificate.validTo.toISOString(),
                expiresSoon: certificate.validTo.getTime() - Date.now() < 30 * DAY_MS,
              }
            : null,
        };
      });
    },
  );

  app.post<{ Params: { accountId: string }; Body: OnboardBody }>(
    '/api/accounts/:accountId/emitters',
    { schema: onboardSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const actor = identityOf(request).email;
      // An emitter made this way finishes the account's onboarding, so the owner is never sent back to it.
      const emitter = await onboarding.create(ctx, actor, request.body, {
        inTransaction: () => steps.markDone(ctx),
      });
      return reply.status(201).send(emitter);
    },
  );

  app.post<{
    Params: { accountId: string; emitterId: string };
    Body: { pfxBase64: string; password: string };
  }>(
    '/api/accounts/:accountId/emitters/:emitterId/certificate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pfxBase64', 'password'],
          additionalProperties: false,
          properties: {
            pfxBase64: { type: 'string', minLength: 1, maxLength: 200_000 },
            password: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const emitter = emitters.get(ctx, request.params.emitterId);
      if (!emitter) throw new HttpError(404, 'not_found');
      const { pfx, material } = openPfx(request.body.pfxBase64, request.body.password);
      if (material.cnpj !== emitter.cnpj) throw new HttpError(400, 'cnpj_mismatch');
      try {
        await deps
          .providerFactory({ environment: emitter.environment, certificate: material })
          .checkConnection(emitter.municipality);
      } catch (error) {
        throw new HttpError(
          502,
          'connection_test_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
      certificates.addActive(
        ctx,
        emitter.id,
        sealCertificate(pfx, request.body.password, deps.masterKey),
        {
          cnpj: material.cnpj,
          subject: material.subject,
          validFrom: material.notBefore,
          validTo: material.notAfter,
          fingerprintSha256: material.fingerprintSha256,
          uploadedBy: ctx.userId,
        },
      );
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'certificate.upload',
        entity: emitter.id,
        result: 'ok',
      });
      return reply.status(204).send();
    },
  );

  app.post<{
    Params: { accountId: string; emitterId: string };
    Body: { environment: 'producao' | 'producao_restrita'; confirm?: string };
  }>(
    '/api/accounts/:accountId/emitters/:emitterId/environment',
    {
      schema: {
        body: {
          type: 'object',
          required: ['environment'],
          additionalProperties: false,
          properties: {
            environment: { enum: ['producao', 'producao_restrita'] },
            confirm: { type: 'string', maxLength: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      // Only the platform admin uses produção restrita; every account works in production.
      if (identityOf(request).platformRole !== 'admin') throw new HttpError(403, 'admin_only');
      const { environment, confirm } = request.body;
      if (environment === 'producao' && confirm !== 'producao') {
        throw new HttpError(400, 'confirmation_required');
      }
      if (!emitters.setEnvironment(ctx, request.params.emitterId, environment)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'emitter.environment',
        entity: request.params.emitterId,
        result: 'ok',
        detail: environment,
      });
      return reply.status(204).send();
    },
  );
}
