import type { FastifyInstance } from 'fastify';
import { adminContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { MailOutbox } from '../mail/outbox';
import { AuditLog } from '../repos/AuditLog';

// The dead letters of the outbox: what the platform admin sees and can send again.
export function adminMailRoutes(
  app: FastifyInstance,
  deps: { db: Database; outbox: MailOutbox },
): void {
  const audit = new AuditLog(deps.db);

  app.get('/api/admin/mail/failed', async (request) => {
    adminContext(request);
    return deps.outbox.failed();
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/mail/:id/retry',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[0-9]{1,12}$' } },
        },
      },
    },
    async (request) => {
      adminContext(request);
      const id = Number(request.params.id);
      if (!deps.outbox.failed().some((row) => row.id === id && row.kind !== 'code')) {
        throw new HttpError(409, 'mail_not_retryable');
      }
      const sent = await deps.outbox.retry(id);
      audit.record({
        userEmail: identityOf(request).email,
        accountId: null,
        action: 'mail.retry',
        entity: String(id),
        result: sent ? 'ok' : 'error',
      });
      return { sent };
    },
  );
}
