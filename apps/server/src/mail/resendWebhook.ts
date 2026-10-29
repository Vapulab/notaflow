import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../metrics/metrics';
import type { MailSuppressionRepository } from '../repos/MailSuppressionRepository';
import type { MailOutbox } from './outbox';

export const RESEND_WEBHOOK_PATH = '/webhooks/resend';

// Svix refuses older deliveries the same way, so a captured request cannot be replayed later.
const TOLERANCE_MS = 300_000;
const SECRET_PREFIX = 'whsec_';

export function validSvixSignature(p: {
  id: unknown;
  timestamp: unknown;
  signature: unknown;
  body: Buffer;
  secret: string;
  now: Date;
}): boolean {
  const { id, timestamp, signature } = p;
  if (typeof id !== 'string' || id === '' || typeof signature !== 'string') return false;
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(p.now.getTime() - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  const key = Buffer.from(p.secret.slice(SECRET_PREFIX.length), 'base64');
  if (key.length === 0) return false;
  const expected = Buffer.from(
    createHmac('sha256', key).update(`${id}.${timestamp}.`).update(p.body).digest('base64'),
  );
  let valid = false;
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || value === undefined) continue;
    const given = Buffer.from(value);
    if (given.length === expected.length && timingSafeEqual(given, expected)) valid = true;
  }
  return valid;
}

const HANDLED = new Set(['email.bounced', 'email.complained']);

function eventOf(
  payload: unknown,
): { type: string; emailId: string | null; permanent: boolean } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { type, data } = payload as { type?: unknown; data?: unknown };
  if (typeof type !== 'string') return null;
  const { email_id: emailId, bounce } = (typeof data === 'object' && data !== null ? data : {}) as {
    email_id?: unknown;
    bounce?: unknown;
  };
  if (typeof emailId !== 'string') {
    return HANDLED.has(type) ? null : { type, emailId: null, permanent: false };
  }
  const permanent = (bounce as { type?: unknown } | null | undefined)?.type === 'Permanent';
  return { type, emailId, permanent };
}

function applyEvent(
  deps: { outbox: MailOutbox; suppressions: MailSuppressionRepository },
  type: string,
  emailId: string,
  permanent: boolean,
): boolean {
  if (type === 'email.bounced' && permanent) {
    const row = deps.outbox.markDelivery(emailId, 'bounced');
    if (row?.kind !== 'invoice') return false;
    deps.suppressions.add(row.to, 'invoice', 'bounce');
    return true;
  }
  if (type === 'email.complained') {
    const row = deps.outbox.markDelivery(emailId, 'complained');
    // Any kind: a person who marks a login code as spam does not want invoice e-mail either.
    if (!row) return false;
    deps.suppressions.add(row.to, 'invoice', 'complaint');
    deps.outbox.cancelPendingInvoice(row.to);
    return true;
  }
  return false;
}

// Outside /api: Resend has no session, so the Svix signature of the raw body is the only check.
export function registerResendWebhook(
  app: FastifyInstance,
  deps: {
    secret: string | null;
    outbox: MailOutbox;
    suppressions: MailSuppressionRepository;
    metrics: Pick<Metrics, 'mailWebhookEvent'>;
    now?: () => Date;
  },
): void {
  const now = deps.now ?? (() => new Date());
  app.register(async (scope) => {
    // The signature covers the exact bytes, so the body stays a Buffer until it is verified.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    scope.post(RESEND_WEBHOOK_PATH, async (request, reply) => {
      const { secret } = deps;
      if (!secret) return reply.status(404).send({ error: 'not_found' });
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const signed = validSvixSignature({
        id: request.headers['svix-id'],
        timestamp: request.headers['svix-timestamp'],
        signature: request.headers['svix-signature'],
        body,
        secret,
        now: now(),
      });
      if (!signed) {
        deps.metrics.mailWebhookEvent('other', 'rejected');
        return reply.status(401).send({ error: 'bad_signature' });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: 'bad_request' });
      }
      const event = eventOf(payload);
      if (!event) return reply.status(400).send({ error: 'bad_request' });

      const applied =
        event.emailId !== null && applyEvent(deps, event.type, event.emailId, event.permanent);
      deps.metrics.mailWebhookEvent(event.type, applied ? 'applied' : 'ignored');
      return reply.status(200).send({ ok: true });
    });
  });
}
