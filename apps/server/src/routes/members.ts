import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { MailOutbox } from '../mail/outbox';
import { inviteEmail } from '../mail/templates';
import { AuditLog } from '../repos/AuditLog';
import { MemberRepository } from '../repos/MemberRepository';

// Each invite sends an e-mail that carries the account name, so a cap keeps it from being a spam relay.
const INVITES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function memberRoutes(
  app: FastifyInstance,
  deps: { db: Database; outbox: MailOutbox; appOrigin: string },
): void {
  const { db } = deps;
  const members = new MemberRepository(db);
  const audit = new AuditLog(db);

  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/members', async (request) =>
    members.list(accountContext(request, request.params.accountId, { owner: true })),
  );

  app.post<{ Params: { accountId: string }; Body: { email: string; name: string } }>(
    '/api/accounts/:accountId/members',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'name'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      if (members.invitesSince(ctx, new Date(Date.now() - DAY_MS)) >= INVITES_PER_DAY) {
        throw new HttpError(429, 'too_many_invites');
      }
      const result = members.invite(ctx, request.body.email, request.body.name);
      if (!result) throw new HttpError(409, 'already_member');
      const identity = identityOf(request);
      const accountName =
        identity.memberships.find((m) => m.accountId === ctx.accountId)?.accountName ?? '';
      // False when the first attempt failed: the outbox retries it in the next minutes.
      const emailSent = await deps.outbox.send(
        {
          to: request.body.email.toLowerCase(),
          ...inviteEmail({
            inviter: identity.name ? `${identity.name} (${identity.email})` : identity.email,
            accountName,
            loginUrl: `${deps.appOrigin}/entrar`,
          }),
        },
        'invite',
      );
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'member.invite',
        entity: result.userId,
        result: 'ok',
      });
      // No created flag: it would tell the owner whether the address already has a user.
      return reply.status(201).send({ userId: result.userId, emailSent });
    },
  );
}
