import type { FastifyInstance } from 'fastify';
import { adminContext } from '../auth/guards';
import { HttpError } from '../httpError';
import { DanfseRepository } from '../repos/DanfseRepository';
import type { Database } from '../db/openDatabase';

const LIMIT = 50;
// The queue keeps up to 30 days of failures; read enough to match the 50 newest rows.
const QUEUE_LOOKUP = 500;

// The invoices whose PDF failed for good: what the platform admin sees and can draw again.
export function adminDanfseRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const repo = new DanfseRepository(deps.db);

  app.get('/api/admin/danfse/failed', async (request) => {
    adminContext(request);
    const rows = repo.failedRows(LIMIT);
    // The reason lives only in the queue; without it the row is still listed and can be retried.
    const reasons = new Map<string, string>();
    if (app.danfse && rows.length > 0) {
      try {
        for (const job of await app.danfse.queue.failed(QUEUE_LOOKUP)) {
          reasons.set(job.invoiceId, job.failedReason);
        }
      } catch (error) {
        request.log.warn({ module: 'danfse', error: String(error) }, 'DANFSe queue unavailable');
      }
    }
    return {
      items: rows.map((row) => ({ ...row, failedReason: reasons.get(row.invoiceId) ?? null })),
    };
  });

  app.post('/api/admin/danfse/retry-all', async (request) => {
    adminContext(request);
    if (!app.danfse) throw new HttpError(404, 'not_found');
    return { count: await app.danfse.dispatcher.retryAll() };
  });

  app.post<{ Params: { invoiceId: string } }>(
    '/api/admin/danfse/:invoiceId/retry',
    {
      schema: {
        params: {
          type: 'object',
          required: ['invoiceId'],
          properties: { invoiceId: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      adminContext(request);
      if (!app.danfse || !(await app.danfse.dispatcher.retry(request.params.invoiceId))) {
        throw new HttpError(404, 'not_found');
      }
      return reply.code(204).send();
    },
  );
}
