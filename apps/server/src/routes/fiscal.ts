import {
  annexRule,
  BAND6_ISS,
  type Band6Iss,
  percentText,
  SIMPLES_ANNEXES,
  type SimplesAnnex,
  simplesBand,
  simplesIssRate,
  simplesRate,
} from '@notaflow/provider-nacional';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

interface FiscalBody {
  simplesAnnex: SimplesAnnex;
  simplesRbt12Cents: number;
  simplesBand6Iss?: Band6Iss;
  issRate?: number; // only where the ISS goes outside the DAS
  ibscbsRegime: 'inside_das' | 'regular';
  ibscbsRegimeFrom?: string;
}

// The Simples Nacional limit is R$ 4,800,000.00 of gross revenue in 12 months.
const RBT12_LIMIT = 480_000_000;

const fiscalSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['simplesAnnex', 'simplesRbt12Cents', 'ibscbsRegime'],
    properties: {
      simplesAnnex: { enum: SIMPLES_ANNEXES },
      simplesRbt12Cents: { type: 'integer', minimum: 0, maximum: RBT12_LIMIT },
      simplesBand6Iss: { enum: BAND6_ISS },
      // LC 116/2003 caps the ISS at 5%.
      issRate: { type: 'integer', minimum: 0, maximum: 500 },
      ibscbsRegime: { enum: ['inside_das', 'regular'] },
      ibscbsRegimeFrom: { type: 'string', format: 'date' },
    },
  },
} as const;

type Params = { accountId: string; emitterId: string };

// The rates of a revenue: pTotTribSN (the effective rate, and the one of an export) and the retained ISS.
export function simplesRates(annex: SimplesAnnex, rbt12Cents: number, band6Iss?: Band6Iss) {
  const options = band6Iss ? { band6Iss } : {};
  return {
    domestic: simplesRate(annex, rbt12Cents, { export: false, ...options }),
    export: simplesRate(annex, rbt12Cents, { export: true, ...options }),
    iss: simplesIssRate(annex, rbt12Cents, options),
  };
}

// Anexos I and II have no ISS in the DAS, so only Anexos III, IV, and V ask in band 6.
function asksBand6Iss(annex: SimplesAnnex, band: number): boolean {
  return band === 6 && annex !== 'I' && annex !== 'II';
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
          ? simplesRates(
              config.simplesAnnex,
              config.simplesRbt12Cents,
              config.simplesBand6Iss ?? undefined,
            )
          : null;
      const rule = annexRule(emitters.cnaesOf(ctx, request.params.emitterId) ?? null);
      return { ...config, rates, annexRule: rule };
    },
  );

  app.get<{
    Params: { accountId: string };
    Querystring: { annex: SimplesAnnex; rbt12Cents: number; band6Iss?: Band6Iss };
  }>(
    '/api/accounts/:accountId/simples-rates',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['annex', 'rbt12Cents'],
          properties: {
            annex: { enum: SIMPLES_ANNEXES },
            rbt12Cents: { type: 'integer', minimum: 0 },
            band6Iss: { enum: BAND6_ISS },
          },
        },
      },
    },
    async (request) => {
      accountContext(request, request.params.accountId);
      const { annex, rbt12Cents, band6Iss } = request.query;
      const band = simplesBand(rbt12Cents);
      if (band === null) throw new HttpError(400, 'outside_simples');
      return { band, ...simplesRates(annex, rbt12Cents, band6Iss) };
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
      const asks = asksBand6Iss(body.simplesAnnex, band);
      if (asks && !body.simplesBand6Iss) throw new HttpError(400, 'band6_iss_required');
      const band6Iss = asks ? (body.simplesBand6Iss ?? null) : null;
      const rates = simplesRates(body.simplesAnnex, body.simplesRbt12Cents, band6Iss ?? undefined);
      const issRate = rates.iss ?? body.issRate;
      if (issRate === undefined) throw new HttpError(400, 'iss_rate_required');
      const config = {
        simplesAnnex: body.simplesAnnex,
        simplesBand: band,
        simplesPercent: rates.domestic,
        simplesRbt12Cents: body.simplesRbt12Cents,
        simplesRbt12At: new Date(),
        simplesBand6Iss: band6Iss,
        issRate,
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
          `${body.simplesAnnex}/${band}${band6Iss ? ` ${band6Iss}` : ''} ` +
          `${percentText(rates.domestic)}% ` +
          `(export ${percentText(rates.export)}%), ` +
          `ISS ${percentText(issRate)}%, ${body.ibscbsRegime}` +
          (body.ibscbsRegimeFrom ? ` from ${body.ibscbsRegimeFrom}` : ''),
      });
      return { ...config, rates };
    },
  );
}
