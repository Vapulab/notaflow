import type { FastifyInstance } from 'fastify';
import { adminContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AdminRepository } from '../repos/AdminRepository';
import { AuditLog } from '../repos/AuditLog';
import { WaitlistRepository } from '../repos/WaitlistRepository';

const email = { type: 'string', format: 'email', maxLength: 254 } as const;
const name = { type: 'string', minLength: 1, maxLength: 200 } as const;

export function adminRoutes(app: FastifyInstance, db: Database): void {
  const admin = new AdminRepository(db);
  const audit = new AuditLog(db);
  const waitlist = new WaitlistRepository(db);

  app.get('/api/admin/waitlist', async (request) => {
    const ctx = adminContext(request);
    return { signups: waitlist.list(ctx), counts: waitlist.counts(ctx) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/waitlist/:id', async (request, reply) => {
    db.transaction(() => {
      if (!waitlist.remove(adminContext(request), request.params.id)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: null,
        action: 'waitlist.remove',
        entity: request.params.id,
        result: 'ok',
        detail: 'e-mail anonymized',
      });
    });
    return reply.status(204).send();
  });

  app.get('/api/admin/accounts', async (request) => admin.listAccounts(adminContext(request)));

  app.get<{ Querystring: { q?: string } }>(
    '/api/admin/users',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => admin.listUsers(adminContext(request), request.query.q?.trim() || undefined),
  );

  app.post<{ Body: { name: string } }>(
    '/api/admin/accounts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name },
        },
      },
    },
    async (request, reply) => {
      const id = admin.createAccount(adminContext(request), request.body.name);
      audit.record({
        userEmail: identityOf(request).email,
        accountId: id,
        action: 'account.create',
        entity: id,
        result: 'ok',
      });
      return reply.status(201).send({ id });
    },
  );

  app.post<{ Params: { accountId: string }; Body: { status: 'active' | 'suspended' } }>(
    '/api/admin/accounts/:accountId/status',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { enum: ['active', 'suspended'] } },
        },
      },
    },
    async (request, reply) => {
      const { accountId } = request.params;
      if (!admin.setAccountStatus(adminContext(request), accountId, request.body.status)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId,
        action: 'account.status',
        entity: accountId,
        result: 'ok',
        detail: request.body.status,
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/anonymize',
    async (request, reply) => {
      const ctx = adminContext(request);
      // The admin would lose access at once; another admin does it.
      if (request.params.userId === ctx.userId) throw new HttpError(409, 'cannot_anonymize_self');
      // One transaction: an erasure is never left without its audit entry.
      db.transaction(() => {
        if (!admin.anonymizeUser(ctx, request.params.userId)) throw new HttpError(404, 'not_found');
        audit.record({
          userEmail: identityOf(request).email,
          accountId: null,
          action: 'user.anonymize',
          entity: request.params.userId,
          result: 'ok',
          detail: 'personal data anonymized',
        });
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { email: string; name: string; platformRole?: 'admin' | 'user' } }>(
    '/api/admin/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'name'],
          additionalProperties: false,
          properties: { email, name, platformRole: { enum: ['admin', 'user'] } },
        },
      },
    },
    async (request, reply) => {
      const ctx = adminContext(request);
      const id = admin.createUser(ctx, request.body.email, request.body.name);
      const actor = identityOf(request).email;
      if (!id) {
        audit.record({
          userEmail: actor,
          accountId: null,
          action: 'user.create',
          entity: request.body.email.toLowerCase(),
          result: 'refused',
          detail: 'exists',
        });
        throw new HttpError(409, 'user_exists');
      }
      if (request.body.platformRole === 'admin') admin.setPlatformRole(ctx, id, 'admin');
      audit.record({
        userEmail: actor,
        accountId: null,
        action: 'user.create',
        entity: id,
        result: 'ok',
      });
      return reply.status(201).send({ id });
    },
  );

  app.put<{
    Params: { accountId: string; userId: string };
    Body: { role: 'owner' | 'member' };
  }>(
    '/api/admin/accounts/:accountId/members/:userId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: { enum: ['owner', 'member'] } },
        },
      },
    },
    async (request, reply) => {
      const { accountId, userId } = request.params;
      if (!admin.setMembership(adminContext(request), accountId, userId, request.body.role)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId,
        action: 'membership.set',
        entity: userId,
        result: 'ok',
        detail: request.body.role,
      });
      return reply.status(204).send();
    },
  );
}
