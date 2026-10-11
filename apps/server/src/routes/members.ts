import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { Mailer } from '../mail/mailer';
import { inviteEmail } from '../mail/templates';
import { AuditLog } from '../repos/AuditLog';
import { MemberRepository } from '../repos/MemberRepository';

export function memberRoutes(
  app: FastifyInstance,
  deps: { db: Database; mailer: Mailer; appOrigin: string },
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
      const result = members.invite(ctx, request.body.email, request.body.name);
      if (!result) throw new HttpError(409, 'already_member');
      const identity = identityOf(request);
      const accountName =
        identity.memberships.find((m) => m.accountId === ctx.accountId)?.accountName ?? '';
      let emailSent = true;
      try {
        await deps.mailer({
          to: request.body.email.toLowerCase(),
          ...inviteEmail({
            inviter: identity.name ? `${identity.name} (${identity.email})` : identity.email,
            accountName,
            loginUrl: `${deps.appOrigin}/entrar`,
          }),
        });
      } catch (error) {
        // The member exists either way; the owner learns that the e-mail did not go and can tell them.
        emailSent = false;
        request.log.warn({ err: error }, 'invite e-mail failed');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'member.invite',
        entity: result.userId,
        result: 'ok',
      });
      return reply.status(201).send({ ...result, emailSent });
    },
  );
}
