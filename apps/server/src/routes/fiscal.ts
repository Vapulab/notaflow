import { percentText, simplesBand, simplesRate } from '@notaflow/provider-nacional';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

interface FiscalBody {
  simplesAnnex: 'III' | 'V';
  simplesRbt12Cents: number;
  issRate: number;
  ibscbsRegime: 'inside_das' | 'regular';
  ibscbsRegimeFrom?: string;
}

// The Simples Nacional limit is R$ 4,800,000.00 of gross revenue in 12 months.
const RBT12_LIMIT = 480_000_000;

const fiscalSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['simplesAnnex', 'simplesRbt12Cents', 'issRate', 'ibscbsRegime'],
    properties: {
      simplesAnnex: { enum: ['III', 'V'] },
      simplesRbt12Cents: { type: 'integer', minimum: 0, maximum: RBT12_LIMIT },
      // LC 116/2003 caps the ISS at 5%.
      issRate: { type: 'integer', minimum: 0, maximum: 500 },
      ibscbsRegime: { enum: ['inside_das', 'regular'] },
      ibscbsRegimeFrom: { type: 'string', format: 'date' },
    },
  },
} as const;

type Params = { accountId: string; emitterId: string };

// The rates of pTotTribSN for a revenue: the effective rate, and the one of an export.
export function simplesRates(annex: 'III' | 'V', rbt12Cents: number) {
  return {
    domestic: simplesRate(annex, rbt12Cents, { export: false }),
    export: simplesRate(annex, rbt12Cents, { export: true }),
  };
}

export function fiscalRoutes(app: FastifyInstance, db: Database): void {
  const emitters = new EmitterRepository(db);
  const audit = new AuditLog(db);

  app.get<{ Params: Params }>(
    '/api/accounts/:accountId/emitters/:emitterId/fiscal',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const config = emitters.fiscalConfig(ctx, request.params.emitterId);
      if (!config) throw new HttpError(404, 'not_found');
      const rates =
        config.simplesAnnex && config.simplesRbt12Cents !== null
          ? simplesRates(config.simplesAnnex, config.simplesRbt12Cents)
          : null;
      return { ...config, rates };
    },
  );

  app.get<{
    Params: { accountId: string };
    Querystring: { annex: 'III' | 'V'; rbt12Cents: number };
  }>(
    '/api/accounts/:accountId/simples-rates',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['annex', 'rbt12Cents'],
          properties: {
            annex: { enum: ['III', 'V'] },
            rbt12Cents: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      accountContext(request, request.params.accountId);
      const { annex, rbt12Cents } = request.query;
      const band = simplesBand(rbt12Cents);
      if (band === null) throw new HttpError(400, 'outside_simples');
      return { band, ...simplesRates(annex, rbt12Cents) };
    },
  );

  app.put<{ Params: Params; Body: FiscalBody }>(
    '/api/accounts/:accountId/emitters/:emitterId/fiscal',
    { schema: fiscalSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const body = request.body;
      const band = simplesBand(body.simplesRbt12Cents);
      if (band === null) throw new HttpError(400, 'outside_simples');
      const rates = simplesRates(body.simplesAnnex, body.simplesRbt12Cents);
      const config = {
        simplesAnnex: body.simplesAnnex,
        simplesBand: band,
        simplesPercent: rates.domestic,
        simplesRbt12Cents: body.simplesRbt12Cents,
        simplesRbt12At: new Date(),
        issRate: body.issRate,
        ibscbsRegime: body.ibscbsRegime,
        ibscbsRegimeFrom: body.ibscbsRegimeFrom ?? null,
      };
      if (!emitters.setFiscalConfig(ctx, request.params.emitterId, config)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'emitter.fiscal',
        entity: request.params.emitterId,
        result: 'ok',
        detail:
          `${body.simplesAnnex}/${band} ${percentText(rates.domestic)}% ` +
          `(export ${percentText(rates.export)}%), ` +
          `ISS ${percentText(body.issRate)}%, ${body.ibscbsRegime}` +
          (body.ibscbsRegimeFrom ? ` from ${body.ibscbsRegimeFrom}` : ''),
      });
      return { ...config, rates };
    },
  );
}
