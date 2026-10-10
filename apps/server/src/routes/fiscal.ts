import { percentText, SIMPLES_BANDS } from '@notaflow/provider-nacional';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

interface FiscalBody {
  simplesAnnex: 'III' | 'V';
  simplesBand: number;
  issRate: number;
  ibscbsRegime: 'inside_das' | 'regular';
  ibscbsRegimeFrom?: string;
}

const fiscalSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['simplesAnnex', 'simplesBand', 'issRate', 'ibscbsRegime'],
    properties: {
      simplesAnnex: { enum: ['III', 'V'] },
      simplesBand: { type: 'integer', minimum: 1, maximum: 6 },
      // LC 116/2003 caps the ISS at 5%.
      issRate: { type: 'integer', minimum: 0, maximum: 500 },
      ibscbsRegime: { enum: ['inside_das', 'regular'] },
      ibscbsRegimeFrom: { type: 'string', format: 'date' },
    },
  },
} as const;

type Params = { accountId: string; emitterId: string };

export function fiscalRoutes(app: FastifyInstance, db: Database): void {
  const emitters = new EmitterRepository(db);
  const audit = new AuditLog(db);

  app.get<{ Params: Params }>(
    '/api/accounts/:accountId/emitters/:emitterId/fiscal',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const config = emitters.fiscalConfig(ctx, request.params.emitterId);
      if (!config) throw new HttpError(404, 'not_found');
      return config;
    },
  );

  app.put<{ Params: Params; Body: FiscalBody }>(
    '/api/accounts/:accountId/emitters/:emitterId/fiscal',
    { schema: fiscalSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const body = request.body;
      const simplesPercent = SIMPLES_BANDS[body.simplesAnnex][body.simplesBand - 1];
      if (simplesPercent === undefined) throw new HttpError(400, 'invalid_band');
      const config = {
        simplesAnnex: body.simplesAnnex,
        simplesBand: body.simplesBand,
        simplesPercent,
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
          `${body.simplesAnnex}/${body.simplesBand} ${percentText(simplesPercent)}%, ` +
          `ISS ${percentText(body.issRate)}%, ${body.ibscbsRegime}` +
          (body.ibscbsRegimeFrom ? ` from ${body.ibscbsRegimeFrom}` : ''),
      });
      return config;
    },
  );
}
