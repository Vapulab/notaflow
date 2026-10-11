import type { AccountContext } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { OnboardingStep } from '../onboarding/types';
import { AuditLog } from '../repos/AuditLog';
import { OnboardingRepository } from '../repos/OnboardingRepository';

type Params = { Params: { accountId: string } };

export function onboardingRoutes(app: FastifyInstance, db: Database): void {
  const onboarding = new OnboardingRepository(db);
  const audit = new AuditLog(db);

  // Moves one step, or answers which step the account is really at.
  const move = (ctx: AccountContext, from: OnboardingStep, to: OnboardingStep) => {
    if (!onboarding.advance(ctx, from, to)) {
      throw new HttpError(409, 'onboarding_step', undefined, { step: onboarding.step(ctx) });
    }
    return { step: to };
  };

  app.post<{ Body: { name: string } }>(
    '/api/onboarding/account',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request, reply) => {
      const identity = identityOf(request);
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, 'invalid_name');
      // One account per signup; joining more accounts is by invitation.
      if (identity.memberships.length > 0) throw new HttpError(409, 'already_member');
      const accountId = onboarding.createAccount(identity.userId, name);
      audit.record({
        userEmail: identity.email,
        accountId,
        action: 'account.create',
        entity: accountId,
        result: 'ok',
        detail: 'onboarding',
      });
      return reply.status(201).send({ accountId });
    },
  );

  app.get<Params>('/api/accounts/:accountId/onboarding', async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    return { step: onboarding.step(ctx), draft: onboarding.draft(ctx) };
  });

  app.post<Params>('/api/accounts/:accountId/onboarding/fiscal-done', async (request) =>
    move(
      accountContext(request, request.params.accountId, { owner: true, write: true }),
      'fiscal',
      'sync',
    ),
  );

  app.post<Params>('/api/accounts/:accountId/onboarding/finish', async (request) =>
    move(
      accountContext(request, request.params.accountId, { owner: true, write: true }),
      'sync',
      'done',
    ),
  );
}
