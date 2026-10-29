import type { R2Client } from '@notaflow/r2';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { danfsePdf, noticeOf } from '../danfse/danfsePdf';
import { HttpError } from '../httpError';
import { isEmailAddress } from '../mail/address';
import { AuditLog } from '../repos/AuditLog';
import { InvoiceMailer } from '../mail/InvoiceMailer';
import type { MailOutbox } from '../mail/outbox';
import type { Unsuppress } from '../mail/resendSuppressions';
import type { Metrics } from '../metrics/metrics';
import { createRateLimiter } from '../rateLimit';
import { InvoiceLinkRepository } from '../repos/InvoiceLinkRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { visitorIp } from '../requestContext';
import { NO_STORE } from '../web';

const TOKEN = { type: 'string', maxLength: 100 } as const;
const tokenParams = {
  type: 'object',
  required: ['token'],
  properties: { token: TOKEN },
} as const;

// Set before validation and the limiter run, so a 400, 404, and 429 carry it too.
const noStore = async (
  _request: unknown,
  reply: { header(name: string, value: string): unknown },
) => {
  reply.header('cache-control', NO_STORE);
};

const emailSchema = {
  body: {
    type: 'object',
    required: ['to'],
    additionalProperties: false,
    properties: {
      to: { type: 'string', format: 'email', maxLength: 254 },
      confirmAddress: { type: 'boolean' },
    },
  },
} as const;

export function invoiceLinkRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    appOrigin: string;
    secret: string;
    outbox: MailOutbox;
    unsuppress: Unsuppress;
    danfseR2?: Pick<R2Client, 'get'> | null;
    metrics?: Pick<Metrics, 'danfseOnDemand' | 'danfseLinkView'>;
  },
): void {
  const audit = new AuditLog(deps.db);
  const links = new InvoiceLinkRepository(deps.db);
  const invoices = new InvoiceRepository(deps.db);
  const limit = createRateLimiter({ windowMs: 60_000, max: 60 });
  const mailer = new InvoiceMailer({
    db: deps.db,
    outbox: deps.outbox,
    appOrigin: deps.appOrigin,
    secret: deps.secret,
    unsuppress: deps.unsuppress,
    log: (line) => app.log.error(line),
  });

  app.post<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/link',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const invoice = invoices.get(ctx, request.params.invoiceId);
      if (!invoice) throw new HttpError(404, 'not_found');
      const shareable = invoice.status === 'issued' || invoice.status === 'cancelled';
      if (!shareable || !invoice.accessKey) throw new HttpError(409, 'invoice_not_shareable');
      return { url: `${deps.appOrigin}/n/${links.linkFor(ctx, invoice.id)}` };
    },
  );

  app.post<{
    Params: { accountId: string; invoiceId: string };
    Body: { to: string; confirmAddress?: boolean };
  }>(
    '/api/accounts/:accountId/invoices/:invoiceId/email',
    { schema: emailSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      if (!invoices.get(ctx, request.params.invoiceId)) throw new HttpError(404, 'not_found');
      const to = request.body.to.trim();
      if (!isEmailAddress(to)) throw new HttpError(400, 'invalid_email');
      const sent = await mailer.sendByHand(
        ctx,
        request.params.invoiceId,
        to,
        identityOf(request).email,
        { confirmAddress: request.body.confirmAddress === true },
      );
      if (!sent) throw new HttpError(409, 'invoice_not_shareable');
      const tag = sent === 'sent' ? '' : `${sent} `;
      // Only the domain: the address belongs to the customer.
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'invoice.email',
        entity: request.params.invoiceId,
        result: 'ok',
        detail: `manual ${tag}@${to.split('@')[1] ?? ''}`,
      });
      return { sent: true };
    },
  );

  app.delete<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/link',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      if (!links.revoke(ctx, request.params.invoiceId)) throw new HttpError(404, 'not_found');
      return reply.status(204).send();
    },
  );

  // A wrong, revoked, or removed token all answer the same 404.
  app.get<{ Params: { token: string } }>(
    '/api/public/n/:token',
    { schema: { params: tokenParams }, onRequest: noStore },
    async (request, reply) => {
      if (!limit(visitorIp(request))) throw new HttpError(429, 'too_many_requests');
      const view = links.publicView(request.params.token);
      if (!view) throw new HttpError(404, 'not_found');
      links.countView(request.params.token);
      deps.metrics?.danfseLinkView();
      return reply.header('x-robots-tag', 'noindex').send({
        emitterName: view.emitterName,
        number: view.number,
        issuedAt: view.issuedAt,
        netCents: view.netCents,
        notice: noticeOf(view.status, view.eventCodes),
        testEnvironment: view.environment === 'producao_restrita',
      });
    },
  );

  app.get<{ Params: { token: string } }>(
    '/api/public/n/:token/pdf',
    { schema: { params: tokenParams }, onRequest: noStore },
    async (request, reply) => {
      if (!limit(visitorIp(request))) throw new HttpError(429, 'too_many_requests');
      const view = links.publicView(request.params.token);
      const source = view ? links.publicPdfSource(request.params.token) : null;
      if (!view || !source) throw new HttpError(404, 'not_found');
      const pdf = await danfsePdf(
        { ...source, status: view.status, eventCodes: view.eventCodes },
        {
          r2: deps.danfseR2 ?? null,
          ...(deps.metrics ? { metrics: deps.metrics } : {}),
          log: request.log,
        },
      );
      const name = (view.number ?? view.invoiceId).replace(/[^0-9A-Za-z-]/g, '');
      return reply
        .header('x-robots-tag', 'noindex')
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="DANFSe-${name}.pdf"`)
        .header('content-length', pdf.length)
        .send(pdf);
    },
  );
}
