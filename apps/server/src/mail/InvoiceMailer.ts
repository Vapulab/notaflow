import type { AccountContext } from '@notaflow/core';
import { parseNfseXml } from '@notaflow/provider-nacional';
import type { Database } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceLinkRepository } from '../repos/InvoiceLinkRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { MemberRepository } from '../repos/MemberRepository';
import { HttpError } from '../httpError';
import { isEmailAddress } from './address';
import type { MailOutbox } from './outbox';
import { invoiceEmail, type RenderedMail } from './templates';

// The address of the customer: the XML first, since it is what the Sefin recorded, then the customer record.
export function customerEmailOf(
  db: Database,
  ctx: AccountContext,
  invoiceId: string,
): string | null {
  const invoices = new InvoiceRepository(db);
  const xml = invoices.xml(ctx, invoiceId);
  if (xml) {
    try {
      const fromXml = parseNfseXml(xml).customer?.email?.trim();
      if (fromXml && isEmailAddress(fromXml)) return fromXml;
    } catch {
      // An unreadable XML falls back to the customer record.
    }
  }
  const customerId = invoices.emailState(ctx, invoiceId)?.customerId;
  const record = customerId ? new CustomerRepository(db).get(ctx, customerId) : null;
  const fromRecord = record?.email?.trim();
  return fromRecord && isEmailAddress(fromRecord) ? fromRecord : null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PER_HOUR = 50; // per account
const PER_INVOICE_DAY = 5;

export class InvoiceMailer {
  private readonly invoices: InvoiceRepository;
  private readonly emitters: EmitterRepository;
  private readonly links: InvoiceLinkRepository;

  constructor(private readonly deps: { db: Database; outbox: MailOutbox; appOrigin: string }) {
    this.invoices = new InvoiceRepository(deps.db);
    this.emitters = new EmitterRepository(deps.db);
    this.links = new InvoiceLinkRepository(deps.db);
  }

  // Null when the invoice cannot be shared yet.
  private render(ctx: AccountContext, invoiceId: string): RenderedMail | null {
    const invoice = this.invoices.emailState(ctx, invoiceId);
    const emitter = invoice ? this.emitters.get(ctx, invoice.emitterId) : null;
    if (!invoice || !emitter) return null;
    const shareable = invoice.status === 'issued' || invoice.status === 'cancelled';
    if (!shareable || !invoice.accessKey) return null;
    return invoiceEmail({
      emitterName: emitter.companyName,
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      netCents: invoice.netCents,
      link: `${this.deps.appOrigin}/n/${this.links.linkFor(ctx, invoiceId)}`,
      test: invoice.environment === 'producao_restrita',
    });
  }

  // Sent now; a failed delivery stays in the outbox for the retries.
  async sendByHand(
    ctx: AccountContext,
    invoiceId: string,
    to: string,
    replyTo: string,
  ): Promise<boolean> {
    const mail = this.render(ctx, invoiceId);
    if (!mail) return false;
    // Counted in the database, so a restart resets nothing; the count and the insert share one tick.
    const now = Date.now();
    const { outbox } = this.deps;
    if (
      outbox.countInvoiceMail({ accountId: ctx.accountId }, new Date(now - HOUR_MS)) >= PER_HOUR ||
      outbox.countInvoiceMail({ accountId: ctx.accountId, invoiceId }, new Date(now - DAY_MS)) >=
        PER_INVOICE_DAY
    ) {
      throw new HttpError(429, 'too_many_requests');
    }
    await outbox.send(
      { ...mail, to, replyTo, ref: { accountId: ctx.accountId, invoiceId } },
      'invoice',
    );
    this.invoices.markCustomerEmailed(ctx, invoiceId, new Date());
    return true;
  }

  // Once per invoice: the claim and the outbox row share one transaction, so a retry finds the claim and sends nothing.
  sendAutomatic(ctx: AccountContext, invoiceId: string): boolean {
    const invoice = this.invoices.emailState(ctx, invoiceId);
    if (!invoice || invoice.origin !== 'app' || invoice.status !== 'issued') return false;
    // A test invoice has no fiscal value: the customer must not hear about it.
    if (invoice.environment !== 'producao') return false;
    if (invoice.customerEmailedAt) return false;
    if (!this.emitters.get(ctx, invoice.emitterId)?.autoEmailCustomer) return false;
    const to = customerEmailOf(this.deps.db, ctx, invoiceId);
    const replyTo = new MemberRepository(this.deps.db).ownerEmail(ctx);
    if (!to || !replyTo) return false;
    return this.deps.db.transaction(() => {
      if (!this.invoices.claimCustomerEmail(ctx, invoiceId, new Date())) return false;
      const mail = this.render(ctx, invoiceId);
      if (!mail) throw new Error('A claimed invoice must render.');
      this.deps.outbox.queue(
        { ...mail, to, replyTo, ref: { accountId: ctx.accountId, invoiceId } },
        'invoice',
        new Date(),
        this.deps.db,
      );
      return true;
    });
  }
}
