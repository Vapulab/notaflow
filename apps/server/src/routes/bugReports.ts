import type { FastifyInstance } from 'fastify';
import { accountContext, adminContext, identityOf } from '../auth/guards';
import type { BugReports } from '../bugs/BugReports';
import {
  decodeImages,
  IMAGE_TYPES,
  type ImageType,
  MAX_BASE64_LENGTH,
  MAX_IMAGES,
} from '../bugs/images';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { BugReportRepository } from '../repos/BugReportRepository';

interface Body {
  title: string;
  description: string;
  pagePath: string;
  images?: { contentType: ImageType; data: string }[];
}

// Three images of at most 1 MB each, in base64, plus the text.
const BODY_LIMIT = 4.5 * 1024 * 1024;

export function bugReportRoutes(app: FastifyInstance, deps: { db: Database; bugs: BugReports }) {
  const audit = new AuditLog(deps.db);
  const repo = new BugReportRepository(deps.db);
  app.post<{ Params: { accountId: string }; Body: Body }>(
    '/api/accounts/:accountId/bug-reports',
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'pagePath'],
          properties: {
            title: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 4000 },
            pagePath: { type: 'string', maxLength: 300, pattern: '^/' },
            images: {
              type: 'array',
              maxItems: MAX_IMAGES,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['contentType', 'data'],
                properties: {
                  contentType: { enum: [...IMAGE_TYPES] },
                  data: {
                    type: 'string',
                    minLength: 4,
                    maxLength: MAX_BASE64_LENGTH,
                    pattern: '^[A-Za-z0-9+/]+={0,2}$',
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Any member, also of a suspended account: a bug may be why the account cannot work.
      const ctx = accountContext(request, request.params.accountId);
      const identity = identityOf(request);
      const title = request.body.title.trim();
      const description = request.body.description.trim();
      if (!title || !description) throw new HttpError(400, 'invalid_bug_report');
      const images = decodeImages(request.body.images ?? []);
      const userAgent = request.headers['user-agent'];
      const id = await deps.bugs.report(
        ctx,
        {
          title,
          description,
          pagePath: safePath(request.body.pagePath),
          userAgent: userAgent ? userAgent.slice(0, 300) : null,
        },
        images,
      );
      audit.record({
        userEmail: identity.email,
        accountId: ctx.accountId,
        action: 'bug.report',
        entity: id,
        result: 'ok',
        ...(images.length > 0 ? { detail: `${images.length} image(s)` } : {}),
      });
      return reply.status(201).send({ id });
    },
  );

  app.get<{ Params: { id: string } }>('/api/admin/bug-reports/:id', async (request) => {
    const report = repo.forAdmin(adminContext(request), request.params.id);
    if (!report) throw new HttpError(404, 'not_found');
    return report;
  });

  app.get<{ Params: { id: string; position: string } }>(
    '/api/admin/bug-reports/:id/images/:position',
    async (request, reply) => {
      const ctx = adminContext(request);
      const position = Number(request.params.position);
      const image = Number.isInteger(position)
        ? repo.imageForAdmin(ctx, request.params.id, position)
        : null;
      if (!image || image.purgedAt) throw new HttpError(404, 'not_found');
      const object = await deps.bugs.image(image.r2Key);
      if (!object) throw new HttpError(404, 'not_found');
      // The image may show a customer's data: no browser or proxy cache keeps it.
      reply
        .header('content-type', image.contentType)
        .header('cache-control', 'private, no-store')
        .header('content-disposition', 'inline');
      if (object.size !== null) reply.header('content-length', object.size);
      return reply.send(object.body);
    },
  );
}

// A path with a backtick, a space, or an @ is stored as /, so the report still goes.
function safePath(path: string): string {
  const route = path.split(/[?#]/)[0] ?? '/';
  return /^\/[A-Za-z0-9/_.~%:-]*$/.test(route) ? route : '/';
}
