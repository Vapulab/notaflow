import { randomBytes, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { AccountContext } from '@notaflow/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, emitters, invoiceEvents, invoiceLinks, invoices } from '../db/schema';
import { created, notDeleted, softDelete } from '../db/stamps';

// Only what the public page may show: never the customer.
export interface PublicInvoiceView {
  invoiceId: string;
  accessKey: string;
  emitterName: string;
  number: string | null;
  issuedAt: Date | null;
  netCents: number;
  status: string;
  eventCodes: string[];
  environment: 'producao' | 'producao_restrita';
}

export class InvoiceLinkRepository {
  constructor(private readonly db: Database) {}

  linkFor(ctx: AccountContext, invoiceId: string): string {
    this.requireInvoice(ctx, invoiceId);
    const existing = this.activeLink(invoiceId);
    if (existing) return existing.token;
    const token = randomBytes(32).toString('base64url');
    this.db
      .insert(invoiceLinks)
      .values({ id: randomUUID(), invoiceId, token, ...created(ctx) })
      .run();
    return token;
  }

  hasLink(ctx: AccountContext, invoiceId: string): boolean {
    return this.ownsInvoice(ctx, invoiceId) && !!this.activeLink(invoiceId);
  }

  revoke(ctx: AccountContext, invoiceId: string): boolean {
    if (!this.ownsInvoice(ctx, invoiceId)) return false;
    const link = this.activeLink(invoiceId);
    return link ? softDelete(this.db, invoiceLinks, link.id, ctx) : false;
  }

  // System read: the one lookup with no account context; it returns only the public fields.
  publicView(token: string): PublicInvoiceView | null {
    const row = this.db
      .select({
        invoiceId: invoices.id,
        accessKey: invoices.accessKey,
        emitterName: emitters.companyName,
        number: invoices.number,
        issuedAt: invoices.issuedAt,
        netCents: invoices.netCents,
        status: invoices.status,
        environment: invoices.environment,
      })
      .from(invoiceLinks)
      .innerJoin(invoices, eq(invoices.id, invoiceLinks.invoiceId))
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .innerJoin(accounts, eq(accounts.id, emitters.accountId))
      .where(
        and(
          eq(invoiceLinks.token, token),
          notDeleted(invoiceLinks),
          notDeleted(invoices),
          notDeleted(emitters),
          notDeleted(accounts),
        ),
      )
      .get();
    if (!row?.accessKey) return null;
    const events = this.db
      .select({ code: invoiceEvents.code })
      .from(invoiceEvents)
      .where(and(eq(invoiceEvents.accessKey, row.accessKey), notDeleted(invoiceEvents)))
      .orderBy(asc(invoiceEvents.registeredAt))
      .all();
    return { ...row, accessKey: row.accessKey, eventCodes: events.map((e) => e.code) };
  }

  // System read for the public PDF: what the DANFSe needs, only through a valid token.
  publicPdfSource(token: string):
    | (Pick<PublicInvoiceView, 'invoiceId' | 'accessKey'> & {
        pdfStatus: 'pending' | 'ready' | 'failed' | null;
        pdfMark: 'none' | 'cancelada' | 'substituida' | null;
        xml: string;
      })
    | null {
    const view = this.publicView(token);
    if (!view) return null;
    const row = this.db
      .select({
        pdfStatus: invoices.pdfStatus,
        pdfMark: invoices.pdfMark,
        xmlGzip: invoices.xmlGzip,
      })
      .from(invoices)
      .where(eq(invoices.id, view.invoiceId))
      .get();
    if (!row?.xmlGzip) return null;
    return {
      invoiceId: view.invoiceId,
      accessKey: view.accessKey,
      pdfStatus: row.pdfStatus,
      pdfMark: row.pdfMark,
      xml: gunzipSync(row.xmlGzip).toString('utf8'),
    };
  }

  countView(token: string): void {
    this.db
      .update(invoiceLinks)
      .set({ views: sql`${invoiceLinks.views} + 1` })
      .where(and(eq(invoiceLinks.token, token), notDeleted(invoiceLinks)))
      .run();
  }

  private activeLink(invoiceId: string) {
    return this.db
      .select({ id: invoiceLinks.id, token: invoiceLinks.token })
      .from(invoiceLinks)
      .where(and(eq(invoiceLinks.invoiceId, invoiceId), notDeleted(invoiceLinks)))
      .get();
  }

  private ownsInvoice(ctx: AccountContext, invoiceId: string): boolean {
    return !!this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(invoices),
          notDeleted(emitters),
        ),
      )
      .get();
  }

  private requireInvoice(ctx: AccountContext, invoiceId: string): void {
    if (!this.ownsInvoice(ctx, invoiceId)) throw new Error('Invoice not found in this account.');
  }
}
