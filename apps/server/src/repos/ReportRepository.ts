import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import type { ReportPeriod } from '@notaflow/invoice-report';
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, invoiceReports, invoices, users } from '../db/schema';
import { created, notDeleted, touched } from '../db/stamps';

export type ReportRecord = typeof invoiceReports.$inferSelect;

export type ReportView = {
  id: string;
  emitterId: string;
  emitterName: string;
  period: ReportPeriod;
  status: ReportRecord['status'];
  invoiceCount: number | null;
  errorCode: string | null;
  createdByName: string | null;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
};

// The invoices a report lists: production, issued or cancelled, by competence.
export function reportableInvoices(period: ReportPeriod) {
  return and(
    eq(invoices.environment, 'producao'),
    inArray(invoices.status, ['issued', 'cancelled']),
    gte(invoices.competence, period.from),
    lte(invoices.competence, period.to),
    notDeleted(invoices),
  );
}

function toView({
  report: r,
  emitterName,
  createdByName,
}: {
  report: ReportRecord;
  emitterName: string;
  createdByName: string | null;
}): ReportView {
  return {
    id: r.id,
    emitterId: r.emitterId,
    emitterName,
    period: { type: r.periodType, from: r.periodFrom, to: r.periodTo },
    // The hourly expiry job may lag, so a ready report past its date already reads as expired.
    status: r.status === 'ready' && r.expiresAt && r.expiresAt <= new Date() ? 'expired' : r.status,
    invoiceCount: r.invoiceCount,
    errorCode: r.errorCode,
    createdByName,
    createdAt: r.createdAt.toISOString(),
    readyAt: r.readyAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
  };
}

export class ReportRepository {
  constructor(private readonly db: Database) {}

  // null when the emitter is not in the account.
  countInvoices(ctx: AccountContext, emitterId: string, period: ReportPeriod): number | null {
    if (!this.ownsEmitter(ctx, emitterId)) return null;
    return (
      this.db
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.emitterId, emitterId), reportableInvoices(period)))
        .get()?.n ?? 0
    );
  }

  create(ctx: AccountContext, emitterId: string, period: ReportPeriod): ReportRecord {
    if (!this.ownsEmitter(ctx, emitterId)) throw new Error('Emitter not found');
    const open = this.db
      .select()
      .from(invoiceReports)
      .where(
        and(
          eq(invoiceReports.accountId, ctx.accountId),
          eq(invoiceReports.createdBy, ctx.userId),
          eq(invoiceReports.emitterId, emitterId),
          eq(invoiceReports.periodType, period.type),
          eq(invoiceReports.periodFrom, period.from),
          eq(invoiceReports.periodTo, period.to),
          inArray(invoiceReports.status, ['pending', 'running']),
          notDeleted(invoiceReports),
        ),
      )
      .get();
    if (open) return open;
    return this.db
      .insert(invoiceReports)
      .values({
        id: randomUUID(),
        accountId: ctx.accountId,
        emitterId,
        periodType: period.type,
        periodFrom: period.from,
        periodTo: period.to,
        ...created(ctx),
      })
      .returning()
      .get();
  }

  list(
    ctx: AccountContext,
    offset: number,
    limit: number,
  ): { reports: ReportView[]; total: number } {
    const where = and(
      eq(invoiceReports.accountId, ctx.accountId),
      notDeleted(invoiceReports),
      notDeleted(emitters),
    );
    const total =
      this.db
        .select({ n: count() })
        .from(invoiceReports)
        .innerJoin(emitters, eq(emitters.id, invoiceReports.emitterId))
        .where(where)
        .get()?.n ?? 0;
    const rows = this.db
      .select({
        report: invoiceReports,
        emitterName: emitters.companyName,
        createdByName: users.name,
      })
      .from(invoiceReports)
      .innerJoin(emitters, eq(emitters.id, invoiceReports.emitterId))
      .leftJoin(users, eq(users.id, invoiceReports.createdBy))
      .where(where)
      .orderBy(desc(invoiceReports.createdAt), desc(invoiceReports.id))
      .limit(limit)
      .offset(offset)
      .all();
    return { total, reports: rows.map(toView) };
  }

  view(ctx: AccountContext, id: string): ReportView | null {
    const row = this.db
      .select({
        report: invoiceReports,
        emitterName: emitters.companyName,
        createdByName: users.name,
      })
      .from(invoiceReports)
      .innerJoin(emitters, eq(emitters.id, invoiceReports.emitterId))
      .leftJoin(users, eq(users.id, invoiceReports.createdBy))
      .where(
        and(
          eq(invoiceReports.id, id),
          eq(invoiceReports.accountId, ctx.accountId),
          notDeleted(invoiceReports),
        ),
      )
      .get();
    return row ? toView(row) : null;
  }

  get(ctx: AccountContext, id: string): ReportRecord | null {
    return (
      this.db
        .select()
        .from(invoiceReports)
        .where(
          and(
            eq(invoiceReports.id, id),
            eq(invoiceReports.accountId, ctx.accountId),
            notDeleted(invoiceReports),
          ),
        )
        .get() ?? null
    );
  }

  // Only a failed report goes back to pending; any other state comes back unchanged.
  retry(ctx: AccountContext, id: string): ReportRecord | null {
    this.db
      .update(invoiceReports)
      .set({ status: 'pending', attempts: 0, errorCode: null, startedAt: null, ...touched(ctx) })
      .where(
        and(
          eq(invoiceReports.id, id),
          eq(invoiceReports.accountId, ctx.accountId),
          eq(invoiceReports.status, 'failed'),
          notDeleted(invoiceReports),
        ),
      )
      .run();
    return this.get(ctx, id);
  }

  private ownsEmitter(ctx: AccountContext, emitterId: string): boolean {
    return !!this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(
        and(
          eq(emitters.id, emitterId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
        ),
      )
      .get();
  }
}
