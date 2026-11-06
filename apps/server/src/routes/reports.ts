import type { AccountContext } from '@notaflow/core';
import {
  monthPeriod,
  PeriodError,
  periodSlug,
  rangePeriod,
  type ReportPeriod,
  yearPeriod,
} from '@notaflow/invoice-report';
import type { R2Client } from '@notaflow/r2';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { createRateLimiter } from '../rateLimit';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';
import { ReportRepository, type ReportView } from '../repos/ReportRepository';

export const MAX_REPORT_INVOICES = 20_000;
const PAGE_SIZE = 20;

type CreateBody = {
  emitterId?: unknown;
  period?: unknown;
  month?: unknown;
  year?: unknown;
  from?: unknown;
  to?: unknown;
};

function periodOf(body: CreateBody): ReportPeriod {
  try {
    if (body.period === 'month' && typeof body.month === 'string') return monthPeriod(body.month);
    if (body.period === 'year' && typeof body.year === 'number') return yearPeriod(body.year);
    if (body.period === 'range' && typeof body.from === 'string' && typeof body.to === 'string') {
      return rangePeriod(body.from, body.to);
    }
  } catch (error) {
    if (error instanceof PeriodError) throw new HttpError(400, error.code);
    throw error;
  }
  throw new HttpError(400, 'invalid_body');
}

export function reportRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    r2: Pick<R2Client, 'get'> | null;
    maxInvoices?: number;
  },
): void {
  const reports = new ReportRepository(deps.db);
  const emitters = new EmitterRepository(deps.db);
  const audit = new AuditLog(deps.db);
  const maxInvoices = deps.maxInvoices ?? MAX_REPORT_INVOICES;
  const createLimit = createRateLimiter({ windowMs: 3_600_000, max: 10 });

  const unavailable = () => {
    if (!deps.r2) throw new HttpError(503, 'reports_unavailable');
  };

  const view = (ctx: AccountContext, id: string): ReportView => {
    const found = reports.view(ctx, id);
    if (!found) throw new HttpError(404, 'not_found');
    return found;
  };

  app.post<{ Params: { accountId: string }; Body: CreateBody }>(
    '/api/accounts/:accountId/reports',
    { schema: { body: { type: 'object' } } },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      unavailable();
      const emitterId = request.body.emitterId;
      if (typeof emitterId !== 'string' || emitterId === '') {
        throw new HttpError(400, 'invalid_body');
      }
      const period = periodOf(request.body);
      const count = reports.countInvoices(ctx, emitterId, period);
      if (count === null) throw new HttpError(404, 'not_found');
      if (count > maxInvoices) throw new HttpError(422, 'report_too_large');
      if (!createLimit(ctx.accountId)) throw new HttpError(429, 'too_many_requests');
      const record = reports.create(ctx, emitterId, period);
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'report.create',
        entity: record.id,
        result: 'ok',
        detail: JSON.stringify({ emitterId, period }),
      });
      return reply.status(202).send({ report: view(ctx, record.id) });
    },
  );

  app.get<{ Params: { accountId: string }; Querystring: { offset?: number } }>(
    '/api/accounts/:accountId/reports',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { offset: { type: 'integer', minimum: 0, maximum: 1_000_000 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      return reports.list(ctx, request.query.offset ?? 0, PAGE_SIZE);
    },
  );

  app.get<{ Params: { accountId: string; reportId: string } }>(
    '/api/accounts/:accountId/reports/:reportId/pdf',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId);
      unavailable();
      const record = reports.get(ctx, request.params.reportId);
      const emitter = record ? emitters.get(ctx, record.emitterId) : null;
      if (!record || !emitter) throw new HttpError(404, 'not_found');
      const expired =
        record.status === 'expired' ||
        (record.status === 'ready' && !!record.expiresAt && record.expiresAt <= new Date());
      if (expired) throw new HttpError(410, 'report_expired');
      if (record.status !== 'ready' || !record.r2Key) throw new HttpError(409, 'report_not_ready');
      const stored = await deps.r2?.get(record.r2Key);
      if (!stored) throw new HttpError(410, 'report_expired');
      const period = { type: record.periodType, from: record.periodFrom, to: record.periodTo };
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'report.download',
        entity: record.id,
        result: 'ok',
        detail: JSON.stringify({ emitterId: record.emitterId, period }),
      });
      reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="Relatorio-NFSe-${emitter.cnpj}-${periodSlug(period)}.pdf"`,
        );
      if (stored.size !== null) reply.header('content-length', stored.size);
      return reply.send(stored.body);
    },
  );

  app.post<{ Params: { accountId: string; reportId: string } }>(
    '/api/accounts/:accountId/reports/:reportId/retry',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      unavailable();
      const before = reports.get(ctx, request.params.reportId);
      if (!before) throw new HttpError(404, 'not_found');
      if (before.status !== 'failed') throw new HttpError(409, 'report_not_failed');
      if (before.errorCode === 'emitter_removed') throw new HttpError(409, 'emitter_removed');
      if (!createLimit(ctx.accountId)) throw new HttpError(429, 'too_many_requests');
      const record = reports.retry(ctx, before.id);
      if (!record) throw new HttpError(404, 'not_found');
      return reply.status(202).send({ report: view(ctx, record.id) });
    },
  );
}
