import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import { searchServiceCodes, serviceCode } from '../data/serviceCodes';
import type { Database } from '../db/openDatabase';
import { xsdDescription } from '../domain/xmlText';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';
import { type ServiceInput, ServiceRepository } from '../repos/ServiceRepository';
import { serviceProperties } from './serviceSchema';

const required = ['name', 'nationalTaxCode', 'description'];

const createSchema = {
  body: { type: 'object', additionalProperties: false, required, properties: serviceProperties },
} as const;

const editSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required,
    properties: { ...serviceProperties, archived: { type: 'boolean' } },
  },
} as const;

export function serviceRoutes(app: FastifyInstance, db: Database): void {
  const emitters = new EmitterRepository(db);
  const services = new ServiceRepository(db);
  const audit = new AuditLog(db);

  const requireKnownCode = (code: string) => {
    if (!serviceCode(code)) throw new HttpError(400, 'unknown_service_code');
  };
  const cleaned = <T extends ServiceInput>(input: T): T => {
    const description = xsdDescription(input.description);
    const name = input.name.trim();
    if (description === null) throw new HttpError(400, 'invalid_description');
    if (name === '') throw new HttpError(400, 'invalid_text', 'name');
    return { ...input, name, description };
  };

  app.get<{
    Params: { accountId: string; emitterId: string };
    Querystring: { archived?: string };
  }>(
    '/api/accounts/:accountId/emitters/:emitterId/services',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { archived: { enum: ['0', '1'] } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      if (!emitters.get(ctx, request.params.emitterId)) throw new HttpError(404, 'not_found');
      return services.list(ctx, request.params.emitterId, {
        includeArchived: request.query.archived === '1',
      });
    },
  );

  app.post<{ Params: { accountId: string; emitterId: string }; Body: ServiceInput }>(
    '/api/accounts/:accountId/emitters/:emitterId/services',
    { schema: createSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      if (!emitters.get(ctx, request.params.emitterId)) throw new HttpError(404, 'not_found');
      requireKnownCode(request.body.nationalTaxCode);
      const created = services.create(ctx, request.params.emitterId, cleaned(request.body));
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'service.create',
        entity: created.id,
        result: 'ok',
        detail: `${created.nationalTaxCode} ${created.name}`,
      });
      return reply.status(201).send(created);
    },
  );

  app.put<{
    Params: { accountId: string; serviceId: string };
    Body: ServiceInput & { archived?: boolean };
  }>('/api/accounts/:accountId/services/:serviceId', { schema: editSchema }, async (request) => {
    const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
    const { archived, ...typed } = request.body;
    const input = cleaned(typed);
    if (!services.get(ctx, request.params.serviceId)) throw new HttpError(404, 'not_found');
    requireKnownCode(input.nationalTaxCode);
    db.transaction(() => {
      services.update(ctx, request.params.serviceId, input);
      if (archived !== undefined) services.setArchived(ctx, request.params.serviceId, archived);
    });
    audit.record({
      userEmail: identityOf(request).email,
      accountId: ctx.accountId,
      action: 'service.edit',
      entity: request.params.serviceId,
      result: 'ok',
      detail: archived === undefined ? input.name : `${input.name} (archived: ${archived})`,
    });
    const service = services.get(ctx, request.params.serviceId);
    if (!service) throw new HttpError(404, 'not_found');
    return service;
  });

  app.get<{ Params: { accountId: string }; Querystring: { q?: string } }>(
    '/api/accounts/:accountId/service-codes',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      accountContext(request, request.params.accountId);
      return searchServiceCodes(request.query.q ?? '');
    },
  );
}
