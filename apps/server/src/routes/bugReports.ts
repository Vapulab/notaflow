import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { BugReports } from '../bugs/BugReports';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';

interface Body {
  title: string;
  description: string;
  pagePath: string;
}

export function bugReportRoutes(app: FastifyInstance, deps: { db: Database; bugs: BugReports }) {
  const audit = new AuditLog(deps.db);
  app.post<{ Params: { accountId: string }; Body: Body }>(
    '/api/accounts/:accountId/bug-reports',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'pagePath'],
          properties: {
            title: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 4000 },
            // A URL path only: no backtick, space, or @ can reach the issue markdown.
            pagePath: { type: 'string', maxLength: 300, pattern: '^/[A-Za-z0-9/_.~%:?#=&-]*$' },
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
      const userAgent = request.headers['user-agent'];
      const id = deps.bugs.report(ctx, {
        title,
        description,
        pagePath: request.body.pagePath.split(/[?#]/)[0] ?? '/',
        userAgent: userAgent ? userAgent.slice(0, 300) : null,
      });
      audit.record({
        userEmail: identity.email,
        accountId: ctx.accountId,
        action: 'bug.report',
        entity: id,
        result: 'ok',
      });
      return reply.status(201).send({ id });
    },
  );
}
