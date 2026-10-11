import { randomUUID } from 'node:crypto';
import type { AccountContext, NewInvoiceInput } from '@notaflow/core';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, touched } from '../db/stamps';
import { emitters, services } from '../db/schema';

type ServiceRow = typeof services.$inferSelect;
type Export = NonNullable<NewInvoiceInput['service']['export']>;

export type ServiceInput = NewInvoiceInput['service'] & { name: string };

export type ServiceView = ServiceInput & {
  id: string;
  emitterId: string;
  origin: 'manual' | 'imported';
  archived: boolean;
};

export class ServiceRepository {
  constructor(private readonly db: Database) {}

  list(
    ctx: AccountContext,
    emitterId: string,
    options: { includeArchived?: boolean } = {},
  ): ServiceView[] {
    return this.db
      .select({ service: services })
      .from(services)
      .innerJoin(emitters, eq(emitters.id, services.emitterId))
      .where(
        and(
          eq(services.emitterId, emitterId),
          eq(emitters.accountId, ctx.accountId),
          options.includeArchived ? undefined : eq(services.archived, false),
        ),
      )
      .orderBy(asc(services.name))
      .all()
      .map((r) => viewOf(r.service));
  }

  get(ctx: AccountContext, serviceId: string): ServiceView | null {
    const row = this.row(ctx, serviceId);
    return row ? viewOf(row) : null;
  }

  create(
    ctx: AccountContext,
    emitterId: string,
    input: ServiceInput,
    origin: { kind: 'manual' } | { kind: 'imported'; importKey: string } = { kind: 'manual' },
  ): ServiceView {
    this.requireEmitter(ctx, emitterId);
    const row = this.db
      .insert(services)
      .values({
        ...created(ctx),
        id: randomUUID(),
        emitterId,
        ...columnsOf(input),
        origin: origin.kind,
        importKey: origin.kind === 'imported' ? origin.importKey : null,
      })
      .returning()
      .get();
    return viewOf(row);
  }

  // Insert only: skipped when a service has this code and description, or was imported under this key.
  importService(
    ctx: AccountContext,
    emitterId: string,
    input: ServiceInput,
    importKey: string,
  ): void {
    this.requireEmitter(ctx, emitterId);
    const twin = this.db
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.emitterId, emitterId),
          eq(services.nationalTaxCode, input.nationalTaxCode),
          eq(services.description, input.description),
        ),
      )
      .get();
    if (twin) return;
    this.db
      .insert(services)
      .values({
        ...created(ctx),
        id: randomUUID(),
        emitterId,
        ...columnsOf(input),
        origin: 'imported',
        importKey,
      })
      // Any unique index: Drizzle 0.45 cannot write the WHERE of a partial index for DO NOTHING.
      .onConflictDoNothing()
      .run();
  }

  update(ctx: AccountContext, serviceId: string, input: ServiceInput): boolean {
    if (!this.row(ctx, serviceId)) return false;
    this.db
      .update(services)
      .set({ ...columnsOf(input), ...touched(ctx) })
      .where(eq(services.id, serviceId))
      .run();
    return true;
  }

  setArchived(ctx: AccountContext, serviceId: string, archived: boolean): boolean {
    if (!this.row(ctx, serviceId)) return false;
    this.db
      .update(services)
      .set({ archived, ...touched(ctx) })
      .where(eq(services.id, serviceId))
      .run();
    return true;
  }

  private row(ctx: AccountContext, serviceId: string): ServiceRow | null {
    return (
      this.db
        .select({ service: services })
        .from(services)
        .innerJoin(emitters, eq(emitters.id, services.emitterId))
        .where(and(eq(services.id, serviceId), eq(emitters.accountId, ctx.accountId)))
        .get()?.service ?? null
    );
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

function columnsOf(input: ServiceInput) {
  return {
    name: input.name,
    nationalTaxCode: input.nationalTaxCode,
    municipalTaxCode: input.municipalTaxCode ?? null,
    nbsCode: input.nbsCode ?? null,
    description: input.description,
    pisCofinsCst: input.pisCofinsCst ?? null,
    ibscbsOperationCode: input.ibsCbs?.operationCode ?? null,
    ibscbsCst: input.ibsCbs?.cst ?? null,
    ibscbsClassCode: input.ibsCbs?.classCode ?? null,
    exportMode: input.export?.mode ?? null,
    exportProviderLink: input.export?.providerLink ?? null,
    exportProviderSupport: input.export?.providerSupport ?? null,
    exportCustomerSupport: input.export?.customerSupport ?? null,
    exportTemporaryGoods: input.export?.temporaryGoods ?? null,
    exportMdic: input.export?.mdic ?? null,
  };
}

function viewOf(row: ServiceRow): ServiceView {
  const ibsCbs =
    row.ibscbsOperationCode && row.ibscbsCst && row.ibscbsClassCode
      ? {
          operationCode: row.ibscbsOperationCode,
          cst: row.ibscbsCst,
          classCode: row.ibscbsClassCode,
        }
      : undefined;
  const exportDefaults =
    row.exportMode &&
    row.exportProviderLink &&
    row.exportProviderSupport &&
    row.exportCustomerSupport &&
    row.exportTemporaryGoods &&
    row.exportMdic
      ? {
          mode: row.exportMode as Export['mode'],
          providerLink: row.exportProviderLink as Export['providerLink'],
          providerSupport: row.exportProviderSupport,
          customerSupport: row.exportCustomerSupport,
          temporaryGoods: row.exportTemporaryGoods as Export['temporaryGoods'],
          mdic: row.exportMdic as Export['mdic'],
        }
      : undefined;
  return {
    id: row.id,
    emitterId: row.emitterId,
    name: row.name,
    nationalTaxCode: row.nationalTaxCode,
    ...(row.municipalTaxCode ? { municipalTaxCode: row.municipalTaxCode } : {}),
    ...(row.nbsCode ? { nbsCode: row.nbsCode } : {}),
    description: row.description,
    ...(row.pisCofinsCst ? { pisCofinsCst: row.pisCofinsCst } : {}),
    ...(ibsCbs ? { ibsCbs } : {}),
    ...(exportDefaults ? { export: exportDefaults } : {}),
    origin: row.origin,
    archived: row.archived,
  };
}
