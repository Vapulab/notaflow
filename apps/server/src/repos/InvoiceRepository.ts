import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AccountContext, Environment, ProviderEvent, ProviderInvoice } from '@notaflow/core';
import { and, asc, count, desc, eq, gte, inArray, like, lte, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, invoiceEvents, invoices } from '../db/schema';

export type InvoiceStatus = (typeof invoices.$inferSelect)['status'];
// Cancellation, cancellation by substitution, cancellation granted after fiscal analysis, ex officio.
export const CANCELLING_EVENTS = ['101101', '105102', '105104', '305101'];
export const DPS_NUMBER_TAKEN =
  'O número da DPS já foi usado por outra NFS-e; emita de novo para usar o próximo.';

// The XML parser turns CRLF into LF, and the Sefin may trim.
const normalized = (text: string) => text.replace(/\r\n?/g, '\n').trim();

// A resend of our own DPS reproduces these values; another system's invoice with the same number does not.
export function isOwnInvoice(
  row: {
    competence: string;
    serviceCents: number;
    description: string;
    customerDocument: string | null;
  },
  invoice: ProviderInvoice,
): boolean {
  return (
    row.competence === invoice.competence &&
    row.serviceCents === invoice.amounts.serviceCents &&
    normalized(row.description) === normalized(invoice.service.description) &&
    row.customerDocument === (invoice.customer?.document?.value ?? null)
  );
}

export interface InvoiceFilter {
  emitterId?: string;
  environment?: Environment;
  status?: InvoiceStatus;
  competenceFrom?: string;
  competenceTo?: string;
  search?: string;
  limit: number;
  offset: number;
}

const summary = {
  id: invoices.id,
  emitterId: invoices.emitterId,
  accessKey: invoices.accessKey,
  number: invoices.number,
  status: invoices.status,
  environment: invoices.environment,
  issuedAt: invoices.issuedAt,
  competence: invoices.competence,
  customerDocument: invoices.customerDocument,
  customerName: invoices.customerName,
  serviceCode: invoices.serviceCode,
  description: invoices.description,
  serviceCents: invoices.serviceCents,
  issCents: invoices.issCents,
  netCents: invoices.netCents,
  origin: invoices.origin,
};

export class InvoiceRepository {
  constructor(private readonly db: Database) {}

  upsertSynced(
    ctx: AccountContext,
    emitterId: string,
    invoice: ProviderInvoice,
    customerId: string | null,
  ): { id: string; created: boolean } {
    this.requireEmitter(ctx, emitterId);
    const cancelled = this.hasCancellingEvent(invoice.accessKey);
    const projection = { customerId, ...projectionOf(invoice) };
    const existing = this.db
      .select()
      .from(invoices)
      .where(eq(invoices.accessKey, invoice.accessKey))
      .get();
    if (existing) {
      const status = existing.status === 'cancelled' || cancelled ? 'cancelled' : existing.status;
      this.db
        .update(invoices)
        .set({ ...projection, status })
        .where(eq(invoices.id, existing.id))
        .run();
      return { id: existing.id, created: false };
    }
    // The row the app created for this DPS, left pending or unknown when the Sefin did not answer.
    const awaiting = this.db
      .select({
        id: invoices.id,
        competence: invoices.competence,
        serviceCents: invoices.serviceCents,
        description: invoices.description,
        customerDocument: invoices.customerDocument,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.emitterId, emitterId),
          eq(invoices.dpsId, invoice.dps.id),
          inArray(invoices.status, ['pending', 'unknown']),
        ),
      )
      .get();
    if (awaiting && isOwnInvoice(awaiting, invoice)) {
      this.promote(awaiting.id, invoice);
      return { id: awaiting.id, created: false };
    }
    if (awaiting) {
      this.db
        .update(invoices)
        .set({
          status: 'rejected',
          sefinMessages: [{ code: 'E0014', message: DPS_NUMBER_TAKEN }],
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, awaiting.id))
        .run();
    }
    const id = randomUUID();
    this.db
      .insert(invoices)
      .values({
        ...projection,
        id,
        emitterId,
        accessKey: invoice.accessKey,
        status: cancelled ? 'cancelled' : 'issued',
        origin: 'synced',
      })
      .run();
    this.linkEvents(id, invoice.accessKey);
    return { id, created: true };
  }

  recordEvent(ctx: AccountContext, emitterId: string, event: ProviderEvent): boolean {
    this.requireEmitter(ctx, emitterId);
    const invoice = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.accessKey, event.accessKey), eq(invoices.emitterId, emitterId)))
      .get();
    const inserted = this.db
      .insert(invoiceEvents)
      .values({
        id: randomUUID(),
        emitterId,
        invoiceId: invoice?.id ?? null,
        accessKey: event.accessKey,
        code: event.code,
        reasonCode: event.reasonCode ?? null,
        justification: event.justification ?? null,
        registeredAt: event.registeredAt,
        xmlGzip: gzipSync(event.xml),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return false;
    if (invoice && CANCELLING_EVENTS.includes(event.code)) {
      this.db
        .update(invoices)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(invoices.id, invoice.id))
        .run();
    }
    return true;
  }

  list(ctx: AccountContext, filter: InvoiceFilter) {
    const conditions: SQL[] = [eq(emitters.accountId, ctx.accountId)];
    if (filter.emitterId) conditions.push(eq(invoices.emitterId, filter.emitterId));
    if (filter.environment) conditions.push(eq(invoices.environment, filter.environment));
    if (filter.status) conditions.push(eq(invoices.status, filter.status));
    if (filter.competenceFrom) conditions.push(gte(invoices.competence, filter.competenceFrom));
    if (filter.competenceTo) conditions.push(lte(invoices.competence, filter.competenceTo));
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(
        like(invoices.number, pattern),
        like(invoices.customerName, pattern),
        like(invoices.customerDocument, pattern),
      );
      if (match) conditions.push(match);
    }
    const where = and(...conditions);
    const total =
      this.db
        .select({ value: count() })
        .from(invoices)
        .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
        .where(where)
        .get()?.value ?? 0;
    const items = this.db
      .select(summary)
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(where)
      .orderBy(desc(invoices.competence), desc(invoices.issuedAt))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
    return { items, total };
  }

  get(ctx: AccountContext, invoiceId: string) {
    const row = this.db
      .select({
        ...summary,
        sefinMessages: invoices.sefinMessages,
        templateOf: invoices.templateOf,
      })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!row) return null;
    const events = this.db
      .select({
        code: invoiceEvents.code,
        reasonCode: invoiceEvents.reasonCode,
        justification: invoiceEvents.justification,
        registeredAt: invoiceEvents.registeredAt,
      })
      .from(invoiceEvents)
      .where(eq(invoiceEvents.accessKey, row.accessKey ?? ''))
      .orderBy(asc(invoiceEvents.registeredAt))
      .all();
    return { ...row, events };
  }

  findIdByAccessKey(ctx: AccountContext, accessKey: string): string | null {
    const row = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.accessKey, accessKey), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.id ?? null;
  }

  xml(ctx: AccountContext, invoiceId: string): string | null {
    const row = this.db
      .select({ xmlGzip: invoices.xmlGzip })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.xmlGzip ? gunzipSync(row.xmlGzip).toString('utf8') : null;
  }

  findByIdempotencyKey(ctx: AccountContext, emitterId: string, key: string): string | null {
    const row = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(
        and(
          eq(invoices.emitterId, emitterId),
          eq(invoices.idempotencyKey, key),
          eq(emitters.accountId, ctx.accountId),
        ),
      )
      .get();
    return row?.id ?? null;
  }

  issueView(ctx: AccountContext, invoiceId: string) {
    return (
      this.db
        .select({
          status: invoices.status,
          number: invoices.number,
          accessKey: invoices.accessKey,
          sefinMessages: invoices.sefinMessages,
        })
        .from(invoices)
        .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
        .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  createPending(
    ctx: AccountContext,
    input: {
      emitterId: string;
      dpsId: string;
      dpsSeries: string;
      dpsNumber: number;
      competence: string;
      serviceCents: number;
      foreignAmountCents?: number;
      description: string;
      customerId: string | null;
      customerDocument: string | null;
      customerName: string | null;
      serviceCode: string;
      environment: Environment;
      templateOf: string | null;
      issueTemplate?: string;
      createdBy: string;
      idempotencyKey?: string;
    },
  ): string {
    this.requireEmitter(ctx, input.emitterId);
    const id = randomUUID();
    this.db
      .insert(invoices)
      .values({
        ...input,
        id,
        accessKey: null,
        status: 'pending',
        origin: 'app',
        issCents: null,
        netCents: input.serviceCents,
        xmlGzip: null,
      })
      .run();
    return id;
  }

  markIssued(ctx: AccountContext, invoiceId: string, invoice: ProviderInvoice): void {
    this.requireInvoice(ctx, invoiceId);
    this.promote(invoiceId, invoice);
  }

  markRejected(
    ctx: AccountContext,
    invoiceId: string,
    errors: { code: string; message: string }[],
  ): void {
    this.requireInvoice(ctx, invoiceId);
    this.db
      .update(invoices)
      .set({ status: 'rejected', sefinMessages: errors, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .run();
  }

  markUnknown(ctx: AccountContext, invoiceId: string, reason: string): void {
    this.requireInvoice(ctx, invoiceId);
    this.db
      .update(invoices)
      .set({
        status: 'unknown',
        sefinMessages: [{ code: 'uncertain', message: reason }],
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .run();
  }

  markCancelled(ctx: AccountContext, invoiceId: string): void {
    this.requireInvoice(ctx, invoiceId);
    this.db
      .update(invoices)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .run();
  }

  issueState(ctx: AccountContext, invoiceId: string) {
    return (
      this.db
        .select({
          status: invoices.status,
          environment: invoices.environment,
          dpsId: invoices.dpsId,
          dpsSeries: invoices.dpsSeries,
          dpsNumber: invoices.dpsNumber,
          emitterId: invoices.emitterId,
          templateOf: invoices.templateOf,
          issueTemplate: invoices.issueTemplate,
          competence: invoices.competence,
          serviceCents: invoices.serviceCents,
          foreignAmountCents: invoices.foreignAmountCents,
          description: invoices.description,
          customerId: invoices.customerId,
          customerDocument: invoices.customerDocument,
        })
        .from(invoices)
        .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
        .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  private promote(invoiceId: string, invoice: ProviderInvoice): void {
    const cancelled = this.hasCancellingEvent(invoice.accessKey);
    this.db
      .update(invoices)
      .set({
        ...projectionOf(invoice),
        accessKey: invoice.accessKey,
        status: cancelled ? 'cancelled' : 'issued',
      })
      .where(eq(invoices.id, invoiceId))
      .run();
    this.linkEvents(invoiceId, invoice.accessKey);
  }

  private hasCancellingEvent(accessKey: string): boolean {
    const row = this.db
      .select({ id: invoiceEvents.id })
      .from(invoiceEvents)
      .where(
        and(eq(invoiceEvents.accessKey, accessKey), inArray(invoiceEvents.code, CANCELLING_EVENTS)),
      )
      .get();
    return row !== undefined;
  }

  private linkEvents(invoiceId: string, accessKey: string): void {
    this.db
      .update(invoiceEvents)
      .set({ invoiceId })
      .where(eq(invoiceEvents.accessKey, accessKey))
      .run();
  }

  private requireInvoice(ctx: AccountContext, invoiceId: string): void {
    if (!this.issueState(ctx, invoiceId)) throw new Error('Invoice not found in this account.');
  }

  private requireEmitter(ctx: AccountContext, emitterId: string): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
  }
}

function projectionOf(invoice: ProviderInvoice) {
  return {
    number: invoice.number,
    dpsId: invoice.dps.id,
    dpsSeries: invoice.dps.series,
    dpsNumber: invoice.dps.number,
    environment: invoice.environment,
    issuedAt: invoice.issuedAt,
    competence: invoice.competence,
    customerDocument: invoice.customer?.document?.value ?? null,
    customerName: invoice.customer?.name ?? null,
    serviceCode: invoice.service.nationalTaxCode,
    description: invoice.service.description,
    serviceCents: invoice.amounts.serviceCents,
    issCents: invoice.amounts.issCents ?? null,
    netCents: invoice.amounts.netCents,
    xmlGzip: gzipSync(invoice.xml),
    updatedAt: new Date(),
  };
}

export type InvoiceSummary = ReturnType<InvoiceRepository['list']>['items'][number];
export type InvoiceDetail = NonNullable<ReturnType<InvoiceRepository['get']>>;
