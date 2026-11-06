import { and, asc, eq, inArray, isNotNull, lt, lte, min, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, invoiceReports, invoices } from '../db/schema';
import { notDeleted, touched } from '../db/stamps';
import { type ReportRecord, reportableInvoices } from './ReportRepository';

export type ReportJob = {
  report: ReportRecord;
  emitter: { legalName: string; cnpj: string; shortName: string };
};

export type ReportInvoiceRow = {
  status: 'issued' | 'cancelled';
  number: string | null;
  customerName: string | null;
  customerDocument: string | null;
  xmlGzip: Buffer | null;
};

const MAX_ATTEMPTS = 2;

// The emitter has no trade name, so the short name is the first two words of the legal name.
const shortNameOf = (legalName: string) => legalName.trim().split(/\s+/).slice(0, 2).join(' ');

// Platform scope: the runner serves every account, with no account context.
export class ReportJobRepository {
  constructor(private readonly db: Database) {}

  // The transaction keeps two runners from taking the same row.
  claimNext(now: Date): ReportJob | null {
    return this.db.transaction((tx) => {
      // A removed emitter can never render; fail its pending reports instead of leaving them queued.
      tx.update(invoiceReports)
        .set({ status: 'failed', errorCode: 'emitter_removed', ...touched(null) })
        .where(
          and(
            eq(invoiceReports.status, 'pending'),
            notDeleted(invoiceReports),
            inArray(
              invoiceReports.emitterId,
              tx.select({ id: emitters.id }).from(emitters).where(isNotNull(emitters.deletedAt)),
            ),
          ),
        )
        .run();
      const row = tx
        .select({ report: invoiceReports, emitter: emitters })
        .from(invoiceReports)
        .innerJoin(emitters, eq(emitters.id, invoiceReports.emitterId))
        .where(
          and(
            eq(invoiceReports.status, 'pending'),
            notDeleted(invoiceReports),
            notDeleted(emitters),
          ),
        )
        .orderBy(asc(invoiceReports.createdAt), asc(invoiceReports.id))
        .limit(1)
        .get();
      if (!row) return null;
      const report = tx
        .update(invoiceReports)
        .set({
          status: 'running',
          startedAt: now,
          attempts: row.report.attempts + 1,
          ...touched(null),
        })
        .where(eq(invoiceReports.id, row.report.id))
        .returning()
        .get();
      return {
        report,
        emitter: {
          legalName: row.emitter.companyName,
          cnpj: row.emitter.cnpj,
          shortName: shortNameOf(row.emitter.companyName),
        },
      };
    });
  }

  invoices(job: ReportJob): ReportInvoiceRow[] {
    const { report } = job;
    const rows = this.db
      .select({
        status: invoices.status,
        number: invoices.number,
        customerName: invoices.customerName,
        customerDocument: invoices.customerDocument,
        xmlGzip: invoices.xmlGzip,
      })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(
        and(
          eq(emitters.id, report.emitterId),
          eq(emitters.accountId, report.accountId),
          notDeleted(emitters),
          reportableInvoices({
            type: report.periodType,
            from: report.periodFrom,
            to: report.periodTo,
          }),
        ),
      )
      .orderBy(sql`${invoices.number} IS NULL`, sql`CAST(${invoices.number} AS INTEGER)`)
      .all();
    return rows.flatMap((r) =>
      r.status === 'issued' || r.status === 'cancelled' ? [{ ...r, status: r.status }] : [],
    );
  }

  markReady(
    id: string,
    r: {
      r2Key: string;
      invoiceCount: number;
      pages: number;
      bytes: number;
      readyAt: Date;
      expiresAt: Date;
    },
  ): void {
    this.db
      .update(invoiceReports)
      .set({ status: 'ready', errorCode: null, ...r, ...touched(null) })
      .where(eq(invoiceReports.id, id))
      .run();
  }

  markFailed(id: string, errorCode: string): void {
    this.db
      .update(invoiceReports)
      .set({ status: 'failed', errorCode, ...touched(null) })
      .where(eq(invoiceReports.id, id))
      .run();
  }

  // A restart interrupted these; a row that already used every attempt fails, so a report that kills the process cannot loop.
  recoverRunning(): number {
    const running = and(eq(invoiceReports.status, 'running'), notDeleted(invoiceReports));
    return this.db.transaction((tx) => {
      const retried = tx
        .update(invoiceReports)
        .set({ status: 'pending', ...touched(null) })
        .where(and(running, lt(invoiceReports.attempts, MAX_ATTEMPTS)))
        .run().changes;
      const failed = tx
        .update(invoiceReports)
        .set({ status: 'failed', errorCode: 'timeout', ...touched(null) })
        .where(running)
        .run().changes;
      return retried + failed;
    });
  }

  failStale(now: Date, maxRunMs: number): number {
    const stale = and(
      eq(invoiceReports.status, 'running'),
      lt(invoiceReports.startedAt, new Date(now.getTime() - maxRunMs)),
      notDeleted(invoiceReports),
    );
    return this.db.transaction((tx) => {
      const retried = tx
        .update(invoiceReports)
        .set({ status: 'pending', ...touched(null) })
        .where(and(stale, lt(invoiceReports.attempts, MAX_ATTEMPTS)))
        .run().changes;
      const failed = tx
        .update(invoiceReports)
        .set({ status: 'failed', errorCode: 'timeout', ...touched(null) })
        .where(stale)
        .run().changes;
      return retried + failed;
    });
  }

  dueForExpiry(now: Date): { id: string; r2Key: string }[] {
    const rows = this.db
      .select({ id: invoiceReports.id, r2Key: invoiceReports.r2Key })
      .from(invoiceReports)
      .where(
        and(
          eq(invoiceReports.status, 'ready'),
          lte(invoiceReports.expiresAt, now),
          isNotNull(invoiceReports.r2Key),
          notDeleted(invoiceReports),
        ),
      )
      .orderBy(asc(invoiceReports.expiresAt))
      .all();
    return rows.flatMap((r) => (r.r2Key ? [{ id: r.id, r2Key: r.r2Key }] : []));
  }

  markExpired(id: string): void {
    this.db
      .update(invoiceReports)
      .set({ status: 'expired', ...touched(null) })
      .where(eq(invoiceReports.id, id))
      .run();
  }

  oldestPendingAgeMs(now: Date): number | null {
    const row = this.db
      .select({ at: min(invoiceReports.createdAt) })
      .from(invoiceReports)
      .where(and(eq(invoiceReports.status, 'pending'), notDeleted(invoiceReports)))
      .get();
    return row?.at ? now.getTime() - new Date(row.at).getTime() : null;
  }
}
