import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuditLog } from '../repos/AuditLog';
import type { BugReports } from './BugReports';

export const WEBHOOK_PATH = '/webhooks/github';

export function validSignature(body: Buffer, header: unknown, secret: string): boolean {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function issueOf(
  payload: unknown,
): { action: string; number: number; url: string; repo: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { action, issue, repository } = payload as Record<string, unknown>;
  const { number, html_url: url } = (issue ?? {}) as { number?: unknown; html_url?: unknown };
  const repo = (repository as { full_name?: unknown } | null)?.full_name;
  if (
    typeof action !== 'string' ||
    typeof number !== 'number' ||
    typeof url !== 'string' ||
    typeof repo !== 'string'
  ) {
    return null;
  }
  return { action, number, url, repo };
}

// Outside /api: GitHub has no session, so the HMAC signature of the raw body is the only check.
export function registerGithubWebhook(
  app: FastifyInstance,
  deps: { secret: string | null; repo: string | null; bugs: BugReports; audit: AuditLog },
): void {
  app.register(async (scope) => {
    // The signature covers the exact bytes, so the body stays a Buffer until it is verified.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    scope.post(WEBHOOK_PATH, async (request, reply) => {
      const { secret } = deps;
      if (!secret) return reply.status(404).send({ error: 'not_found' });
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      if (!validSignature(body, request.headers['x-hub-signature-256'], secret)) {
        return reply.status(401).send({ error: 'bad_signature' });
      }
      if (request.headers['x-github-event'] !== 'issues') return reply.status(204).send();
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: 'bad_request' });
      }
      const event = issueOf(payload);
      const status =
        event?.action === 'closed' ? 'closed' : event?.action === 'reopened' ? 'open' : null;
      // Issue numbers are per repository: an event from another one must not touch a report.
      if (!event || !status || event.repo.toLowerCase() !== deps.repo?.toLowerCase()) {
        return reply.status(204).send();
      }
      const report = deps.bugs.issueChanged(event.url, status);
      if (report) {
        deps.audit.record({
          userEmail: 'github',
          accountId: report.accountId,
          action: status === 'closed' ? 'bug.resolve' : 'bug.reopen',
          entity: report.id,
          result: 'ok',
          detail: `issue #${event.number}`,
        });
      }
      return reply.status(204).send();
    });
  });
}
