import type { FastifyInstance } from 'fastify';
import { identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { LEGAL_VERSION } from '../legal';
import { AuditLog } from '../repos/AuditLog';
import { IdentityRepository } from '../repos/IdentityRepository';
import { LegalAcceptanceRepository } from '../repos/LegalAcceptanceRepository';

export function meRoutes(app: FastifyInstance, db: Database): void {
  const identities = new IdentityRepository(db);
  const legal = new LegalAcceptanceRepository(db);
  const audit = new AuditLog(db);
  app.get('/api/me', async (request) => {
    const identity = identityOf(request);
    return {
      // The admin panel links users by id, so a person needs a way to read their own.
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      platformRole: identity.platformRole,
      tourSeenAt: identity.tourSeenAt?.toISOString() ?? null,
      // The app asks to accept the terms and the privacy policy before any other screen.
      legalVersion: LEGAL_VERSION,
      legalAccepted: legal.hasAccepted(identity.userId, LEGAL_VERSION),
      accounts: identity.memberships.map((m) => ({
        id: m.accountId,
        name: m.accountName,
        role: m.role,
        status: m.accountStatus,
        onboardingStep: m.onboardingStep,
        needsFiscalConfig: m.needsFiscalConfig,
      })),
    };
  });

  app.post<{ Body: { version: string } }>(
    '/api/me/legal-acceptance',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'string', maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const identity = identityOf(request);
      // The user accepts the texts they saw; an older page must reload the current ones.
      if (request.body.version !== LEGAL_VERSION) throw new HttpError(409, 'legal_version_changed');
      if (legal.accept(identity.userId, LEGAL_VERSION)) {
        audit.record({
          userEmail: identity.email,
          accountId: null,
          action: 'legal.accept',
          entity: LEGAL_VERSION,
          result: 'ok',
        });
      }
      return reply.status(204).send();
    },
  );

  app.post('/api/me/tour-seen', async (request, reply) => {
    identities.markTourSeen(identityOf(request).userId);
    return reply.status(204).send();
  });
}
