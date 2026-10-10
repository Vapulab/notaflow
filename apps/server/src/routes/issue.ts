import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { accountContext, identityOf } from '../auth/guards';
import { BACEN_CURRENCY, fetchPtaxSell } from '../exchange/ptax';
import { HttpError } from '../httpError';
import type { IssueInput, IssueService, NewInvoiceRequest } from '../issue/IssueService';

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{8,100}$/;

const issueSchema = {
  body: {
    type: 'object',
    required: ['templateInvoiceId', 'competence', 'serviceCents'],
    additionalProperties: false,
    properties: {
      templateInvoiceId: { type: 'string', maxLength: 64 },
      competence: { type: 'string', pattern: DATE },
      serviceCents: { type: 'integer', minimum: 0 },
      foreignAmountCents: { type: 'integer', minimum: 0 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
      customerId: { type: 'string', maxLength: 64 },
    },
  },
} as const;

const newInvoiceSchema = {
  body: {
    type: 'object',
    required: ['emitterId', 'customerId', 'serviceId', 'competence', 'serviceCents'],
    additionalProperties: false,
    properties: {
      emitterId: { type: 'string', maxLength: 64 },
      customerId: { type: 'string', maxLength: 64 },
      serviceId: { type: 'string', maxLength: 64 },
      competence: { type: 'string', pattern: DATE },
      serviceCents: { type: 'integer', minimum: 0 },
      foreignCurrency: { type: 'string', pattern: '^\\d{3}$' },
      foreignAmountCents: { type: 'integer', minimum: 0 },
      simplesPercent: { type: 'integer', minimum: 1, maximum: 10_000 },
      // LC 116/2003 caps the ISS at 5%.
      issRate: { type: 'integer', minimum: 0, maximum: 500 },
      issRetained: { type: 'boolean' },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
} as const;

function idempotencyKeyOf(headers: Record<string, unknown>): string | undefined {
  const key = headers['idempotency-key'];
  if (key !== undefined && (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key))) {
    throw new HttpError(400, 'invalid_idempotency_key');
  }
  return key;
}

const rateSchema = {
  querystring: {
    type: 'object',
    required: ['currency', 'date'],
    additionalProperties: false,
    properties: {
      currency: { type: 'string', pattern: '^\\d{3}$' },
      date: { type: 'string', pattern: DATE },
    },
  },
} as const;

const cancelSchema = {
  body: {
    type: 'object',
    required: ['reason', 'justification'],
    additionalProperties: false,
    properties: {
      reason: { enum: ['1', '2', '9'] },
      justification: { type: 'string', minLength: 15, maxLength: 255 },
    },
  },
} as const;

export function issueRoutes(
  app: FastifyInstance,
  deps: { issue: IssueService; ptaxDispatcher?: Dispatcher },
): void {
  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/draft',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      return deps.issue.draft(ctx, request.params.invoiceId);
    },
  );

  app.get<{ Params: { accountId: string }; Querystring: { currency: string; date: string } }>(
    '/api/accounts/:accountId/exchange-rate',
    { schema: rateSchema },
    async (request) => {
      accountContext(request, request.params.accountId);
      const currency = BACEN_CURRENCY[request.query.currency];
      if (!currency) throw new HttpError(400, 'unsupported_currency');
      try {
        const rate = await fetchPtaxSell({
          currency,
          date: request.query.date,
          ...(deps.ptaxDispatcher ? { dispatcher: deps.ptaxDispatcher } : {}),
        });
        return { ...rate, rate: (rate.rateE4 / 10_000).toFixed(4) };
      } catch (error) {
        request.log.warn({ err: error }, 'PTAX lookup failed');
        throw new HttpError(502, 'ptax_unavailable');
      }
    },
  );

  app.post<{ Params: { accountId: string }; Body: IssueInput }>(
    '/api/accounts/:accountId/invoices/issue',
    { schema: issueSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const { view, repeat } = await deps.issue.issue(
        ctx,
        identityOf(request).email,
        request.body,
        idempotencyKeyOf(request.headers),
      );
      return reply.status(repeat ? 200 : 201).send(view);
    },
  );

  app.post<{ Params: { accountId: string }; Body: NewInvoiceRequest }>(
    '/api/accounts/:accountId/invoices/new',
    { schema: newInvoiceSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const { view, repeat } = await deps.issue.issueNew(
        ctx,
        identityOf(request).email,
        request.body,
        idempotencyKeyOf(request.headers),
      );
      return reply.status(repeat ? 200 : 201).send(view);
    },
  );

  app.post<{
    Params: { accountId: string; invoiceId: string };
    Body: { reason: '1' | '2' | '9'; justification: string };
  }>(
    '/api/accounts/:accountId/invoices/:invoiceId/cancel',
    { schema: cancelSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const { reason, justification } = request.body;
      return deps.issue.cancel(
        ctx,
        identityOf(request).email,
        request.params.invoiceId,
        reason,
        justification,
      );
    },
  );

  app.post<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/reconcile',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      return deps.issue.reconcile(ctx, identityOf(request).email, request.params.invoiceId);
    },
  );
}
