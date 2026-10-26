import type { DanfseMark } from '@notaflow/danfse-pdf';
import { and, asc, eq, isNotNull, isNull, lte, min, or } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { invoiceEvents, invoices } from '../db/schema';
import { pdfPending } from './InvoiceRepository';
import { notDeleted, touched } from '../db/stamps';

export interface DueInvoice {
  id: string;
  accessKey: string;
  status: string;
  xmlGzip: Buffer;
  eventCodes: string[];
  // The version to hand back to markEnqueued.
  pendingSince: Date | null;
}

const REENQUEUE_AFTER_MS = 10 * 60_000;

// Platform scope: the sweep and the worker results run for every account, with no account context.
export class DanfseRepository {
  constructor(private readonly db: Database) {}

  // Pending rows never enqueued, or enqueued more than 10 minutes ago; oldest first.
  due(now: Date, limit: number): DueInvoice[] {
    const rows = this.db
      .select({
        id: invoices.id,
        accessKey: invoices.accessKey,
        status: invoices.status,
        xmlGzip: invoices.xmlGzip,
        pendingSince: invoices.pdfPendingSince,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.pdfStatus, 'pending'),
          or(
            isNull(invoices.pdfEnqueuedAt),
            lte(invoices.pdfEnqueuedAt, new Date(now.getTime() - REENQUEUE_AFTER_MS)),
          ),
          isNotNull(invoices.xmlGzip),
          isNotNull(invoices.accessKey),
          notDeleted(invoices),
        ),
      )
      .orderBy(asc(invoices.pdfEnqueuedAt), asc(invoices.updatedAt))
      .limit(limit)
      .all();
    const due: DueInvoice[] = [];
    for (const row of rows) {
      if (!row.accessKey || !row.xmlGzip) continue;
      const events = this.db
        .select({ code: invoiceEvents.code })
        .from(invoiceEvents)
        .where(and(eq(invoiceEvents.accessKey, row.accessKey), notDeleted(invoiceEvents)))
        .orderBy(asc(invoiceEvents.registeredAt))
        .all();
      due.push({
        id: row.id,
        accessKey: row.accessKey,
        status: row.status,
        xmlGzip: row.xmlGzip,
        eventCodes: events.map((e) => e.code),
        pendingSince: row.pendingSince,
      });
    }
    return due;
  }

  // False when the invoice changed since `due` read it: the new change keeps the row pending.
  markEnqueued(id: string, mark: DanfseMark, now: Date, pendingSince: Date | null): boolean {
    return (
      this.db
        .update(invoices)
        .set({ pdfMark: mark, pdfEnqueuedAt: now, ...touched(null) })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.pdfStatus, 'pending'),
            pendingSince
              ? eq(invoices.pdfPendingSince, pendingSince)
              : isNull(invoices.pdfPendingSince),
            notDeleted(invoices),
          ),
        )
        .run().changes > 0
    );
  }

  // A write that changed the invoice clears the enqueue time, so a result of the older job misses.
  markRendered(id: string, mark: DanfseMark, now: Date): boolean {
    return (
      this.db
        .update(invoices)
        .set({ pdfStatus: 'ready', pdfRenderedAt: now, ...touched(null) })
        .where(this.waitingFor(id, mark))
        .run().changes > 0
    );
  }

  markFailed(id: string, mark: DanfseMark): boolean {
    return (
      this.db
        .update(invoices)
        .set({ pdfStatus: 'failed', ...touched(null) })
        .where(this.waitingFor(id, mark))
        .run().changes > 0
    );
  }

  retry(id: string): boolean {
    return (
      this.db
        .update(invoices)
        .set({ ...pdfPending(), ...touched(null) })
        .where(and(eq(invoices.id, id), eq(invoices.pdfStatus, 'failed'), notDeleted(invoices)))
        .run().changes > 0
    );
  }

  oldestPendingAt(): Date | null {
    const row = this.db
      .select({ at: min(invoices.pdfPendingSince) })
      .from(invoices)
      .where(and(eq(invoices.pdfStatus, 'pending'), notDeleted(invoices)))
      .get();
    return row?.at ? new Date(row.at) : null;
  }

  private waitingFor(id: string, mark: DanfseMark) {
    return and(
      eq(invoices.id, id),
      eq(invoices.pdfStatus, 'pending'),
      eq(invoices.pdfMark, mark),
      isNotNull(invoices.pdfEnqueuedAt),
      notDeleted(invoices),
    );
  }
}
