import type { FastifyInstance } from 'fastify';
import { identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { IdentityRepository } from '../repos/IdentityRepository';

export function meRoutes(app: FastifyInstance, db: Database): void {
  const identities = new IdentityRepository(db);
  app.get('/api/me', async (request) => {
    const identity = identityOf(request);
    return {
      // The admin panel links users by id, so a person needs a way to read their own.
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      platformRole: identity.platformRole,
      tourSeenAt: identity.tourSeenAt?.toISOString() ?? null,
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

  app.post('/api/me/tour-seen', async (request, reply) => {
    identities.markTourSeen(identityOf(request).userId);
    return reply.status(204).send();
  });
}
