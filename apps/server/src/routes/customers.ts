import type { PartyAddress } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { isValidCnpj, isValidCpf } from '../domain/documents';
import { AuditLog } from '../repos/AuditLog';
import {
  CustomerRepository,
  type CustomerRow,
  type NewCustomer,
} from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';

interface CustomerEdit {
  name?: string;
  email?: string;
  phone?: string;
  municipalRegistration?: string;
  address?: PartyAddress;
}

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

const addressSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'street', 'number', 'district'],
  properties: {
    kind: { enum: ['domestic', 'foreign'] },
    municipality: { type: 'string', pattern: '^[0-9]{7}$' },
    zip: { type: 'string', pattern: '^[0-9]{8}$' },
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    postalCode: text(11),
    city: text(60),
    region: text(60),
    street: text(255),
    number: text(60),
    complement: text(156),
    district: text(60),
  },
} as const;

const editSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: text(150),
      email: { type: 'string', format: 'email', maxLength: 80 },
      phone: { type: 'string', pattern: '^[0-9]{6,20}$' },
      municipalRegistration: text(15),
      address: addressSchema,
    },
  },
} as const;

const createSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['emitterId', 'documentType', 'name'],
    properties: {
      emitterId: { type: 'string', minLength: 1, maxLength: 64 },
      documentType: { enum: ['CNPJ', 'CPF', 'NIF', 'NONE'] },
      document: { type: 'string', minLength: 1, maxLength: 40 },
      name: text(150),
      email: { type: 'string', format: 'email', maxLength: 80 },
      phone: { type: 'string', pattern: '^[0-9]{6,20}$' },
      municipalRegistration: text(15),
      address: addressSchema,
    },
  },
} as const;

type CreateBody = Omit<NewCustomer, 'document' | 'address'> & {
  emitterId: string;
  document?: string;
  address?: PartyAddress;
};

// The kind (Brazil or abroad) follows from the document; each kind needs the address the DPS needs.
function checkNewCustomer(body: CreateBody): NewCustomer {
  const { emitterId: _emitterId, document, address, ...rest } = body;
  const brazil = body.documentType === 'CNPJ' || body.documentType === 'CPF';
  const validDocument =
    body.documentType === 'CNPJ'
      ? document !== undefined && isValidCnpj(document)
      : body.documentType === 'CPF'
        ? document !== undefined && isValidCpf(document)
        : body.documentType === 'NIF'
          ? document !== undefined
          : document === undefined;
  if (!validDocument) throw new HttpError(400, 'invalid_document');
  if (brazil) {
    if (address?.kind !== 'domestic' || !address.municipality || !address.zip) {
      throw new HttpError(400, 'customer_address_incomplete');
    }
  } else {
    if (address?.kind !== 'foreign' || !address.country) {
      throw new HttpError(400, 'customer_country_missing');
    }
    if (!address.postalCode || !address.city || !address.region) {
      throw new HttpError(400, 'customer_address_incomplete');
    }
  }
  return { ...rest, document: document ?? null, address };
}

const REQUIRED_BY_KIND = {
  domestic: ['municipality', 'zip'],
  foreign: ['country', 'postalCode', 'city', 'region'],
} as const;

function withoutManualFields({ manualFields: _manualFields, ...customer }: CustomerRow) {
  return customer;
}

export function customerRoutes(app: FastifyInstance, db: Database): void {
  const customers = new CustomerRepository(db);
  const emitters = new EmitterRepository(db);
  const audit = new AuditLog(db);

  app.post<{ Params: { accountId: string }; Body: CreateBody }>(
    '/api/accounts/:accountId/customers',
    { schema: createSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      if (!emitters.get(ctx, request.body.emitterId)) throw new HttpError(404, 'not_found');
      const created = customers.createManual(
        ctx,
        request.body.emitterId,
        checkNewCustomer(request.body),
      );
      if (!created) throw new HttpError(409, 'customer_exists');
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'customer.create',
        entity: created.id,
        result: 'ok',
        detail: `${created.documentType} ${created.name}`,
      });
      return reply.status(201).send(withoutManualFields(created));
    },
  );

  app.get<{ Params: { accountId: string }; Querystring: { emitterId?: string; q?: string } }>(
    '/api/accounts/:accountId/customers',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { emitterId: { type: 'string' }, q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { emitterId, q } = request.query;
      return customers
        .list(ctx, { ...(emitterId ? { emitterId } : {}), ...(q ? { search: q } : {}) })
        .map(withoutManualFields);
    },
  );

  app.get<{ Params: { accountId: string; customerId: string } }>(
    '/api/accounts/:accountId/customers/:customerId',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const customer = customers.get(ctx, request.params.customerId);
      if (!customer) throw new HttpError(404, 'not_found');
      return withoutManualFields(customer);
    },
  );

  app.put<{ Params: { accountId: string; customerId: string }; Body: CustomerEdit }>(
    '/api/accounts/:accountId/customers/:customerId',
    { schema: editSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const { address } = request.body;
      if (address && REQUIRED_BY_KIND[address.kind].some((field) => !(field in address))) {
        throw new HttpError(400, 'invalid_address');
      }
      if (!customers.setManual(ctx, request.params.customerId, request.body)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'customer.edit',
        entity: request.params.customerId,
        result: 'ok',
        detail: Object.keys(request.body).join(', '),
      });
      const customer = customers.get(ctx, request.params.customerId);
      if (!customer) throw new HttpError(404, 'not_found');
      return withoutManualFields(customer);
    },
  );
}
