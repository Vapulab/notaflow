import type { FastifyInstance } from 'fastify';
import { adminContext } from '../auth/guards';
import type { FailedJob } from '../danfse/queue';
import { HttpError } from '../httpError';
import { DanfseRepository } from '../repos/DanfseRepository';
import type { Database } from '../db/openDatabase';

const LIMIT = 50;

// The DANFSe jobs that failed for good: what the platform admin sees and can draw again.
export function adminDanfseRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const repo = new DanfseRepository(deps.db);

  app.get('/api/admin/danfse/failed', async (request) => {
    adminContext(request);
    if (!app.danfse) return { items: [] };
    let jobs: FailedJob[];
    try {
      jobs = await app.danfse.queue.failed(LIMIT);
    } catch (error) {
      request.log.warn({ module: 'danfse', error: String(error) }, 'DANFSe queue unavailable');
      throw new HttpError(503, 'queue_unavailable');
    }
    const known = new Map(
      repo.describe(jobs.map((j) => j.invoiceId)).map((row) => [row.invoiceId, row]),
    );
    const items = jobs.flatMap((job) => {
      const row = known.get(job.invoiceId);
      if (!row) return [];
      return [
        {
          invoiceId: job.invoiceId,
          accessKey: row.accessKey,
          accountName: row.accountName,
          failedReason: job.failedReason,
          failedAt: job.failedAt,
        },
      ];
    });
    return { items };
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
