import { markFor, renderDanfse } from '@notaflow/danfse-pdf';
import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { ProviderFactory } from '../providers/providerFactory';
import { CertificateRepository } from '../repos/CertificateRepository';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { type InvoiceFilter, InvoiceRepository } from '../repos/InvoiceRepository';
import { ServiceRepository } from '../repos/ServiceRepository';
import { applyDocument } from '../sync/applyDocument';
import { VaultCertificateStore } from '../vault/VaultCertificateStore';

const ACCESS_KEY = /^[0-9A-Z]{50}$/;

interface ListQuery {
  emitterId?: string;
  environment?: 'producao' | 'producao_restrita';
  status?: NonNullable<InvoiceFilter['status']>;
  competenceFrom?: string;
  competenceTo?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const listSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      emitterId: { type: 'string' },
      environment: { enum: ['producao', 'producao_restrita'] },
      status: { enum: ['pending', 'issued', 'rejected', 'unknown', 'cancelled'] },
      competenceFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      competenceTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      q: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
  },
} as const;

export function invoiceRoutes(
  app: FastifyInstance,
  deps: { db: Database; masterKey: Buffer; providerFactory: ProviderFactory },
): void {
  const invoices = new InvoiceRepository(deps.db);
  const customers = new CustomerRepository(deps.db);
  const emitters = new EmitterRepository(deps.db);
  const certificates = new VaultCertificateStore(
    new CertificateRepository(deps.db),
    deps.masterKey,
  );

  app.get<{ Params: { accountId: string }; Querystring: ListQuery }>(
    '/api/accounts/:accountId/invoices',
    { schema: listSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { q, limit = 50, offset = 0, ...filters } = request.query;
      return invoices.list(ctx, { ...filters, ...(q ? { search: q } : {}), limit, offset });
    },
  );

  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const invoice = invoices.get(ctx, request.params.invoiceId);
      if (!invoice) throw new HttpError(404, 'not_found');
      return invoice;
    },
  );

  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/xml',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId);
      const invoice = invoices.get(ctx, request.params.invoiceId);
      const xml = invoice ? invoices.xml(ctx, invoice.id) : null;
      if (!invoice || xml === null) throw new HttpError(404, 'not_found');
      return reply
        .header('content-type', 'application/xml; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="NFSe-${invoice.number ?? invoice.id}.xml"`,
        )
        .send(xml);
    },
  );

  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/danfse',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId);
      const invoice = invoices.get(ctx, request.params.invoiceId);
      const xml = invoice ? invoices.xml(ctx, invoice.id) : null;
      if (!invoice || xml === null) throw new HttpError(404, 'not_found');
      const mark = markFor(
        invoice.status,
        invoice.events.map((event) => event.code),
      );
      const pdf = await renderDanfse(xml, { mark });
      const name = (invoice.number ?? invoice.id).replace(/[^0-9A-Za-z-]/g, '');
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="DANFSe-${name}.pdf"`)
        .send(Buffer.from(pdf));
    },
  );

  app.post<{ Params: { accountId: string }; Body: { accessKey: string } }>(
    '/api/accounts/:accountId/invoices/lookup',
    {
      schema: {
        body: {
          type: 'object',
          required: ['accessKey'],
          additionalProperties: false,
          properties: { accessKey: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const accessKey = request.body.accessKey.trim().toUpperCase();
      if (!ACCESS_KEY.test(accessKey)) throw new HttpError(400, 'invalid_access_key');
      // Key layout: municipality (7), environment (1), registration type (1), then the issuer CNPJ.
      const emitter = emitters.findByCnpj(ctx, accessKey.slice(9, 23));
      if (!emitter) throw new HttpError(404, 'emitter_not_found');
      const certificate = await certificates.loadActive(ctx, emitter.id);
      if (!certificate) throw new HttpError(409, 'no_active_certificate');
      const invoice = await deps
        .providerFactory({ environment: emitter.environment, certificate })
        .getInvoice(accessKey);
      if (!invoice) throw new HttpError(404, 'invoice_not_found');
      if (invoice.provider.cnpj !== emitter.cnpj) throw new HttpError(404, 'emitter_not_found');
      const counts = { invoices: 0, events: 0, skipped: 0 };
      deps.db.transaction(() =>
        applyDocument(
          { customers, invoices, services: new ServiceRepository(deps.db) },
          ctx,
          emitter.id,
          { kind: 'invoice', nsu: 0, invoice },
          counts,
        ),
      );
      const id = invoices.findIdByAccessKey(ctx, accessKey);
      if (!id) throw new HttpError(500, 'internal_error');
      return { id };
    },
  );
}
