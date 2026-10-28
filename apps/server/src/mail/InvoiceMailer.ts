import type { AccountContext } from '@notaflow/core';
import { parseNfseXml } from '@notaflow/provider-nacional';
import type { Database } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceLinkRepository } from '../repos/InvoiceLinkRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { MemberRepository } from '../repos/MemberRepository';
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
      if (fromXml) return fromXml;
    } catch {
      // An unreadable XML falls back to the customer record.
    }
  }
  const customerId = invoices.emailState(ctx, invoiceId)?.customerId;
  const record = customerId ? new CustomerRepository(db).get(ctx, customerId) : null;
  return record?.email?.trim() || null;
}

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
    await this.deps.outbox.send({ ...mail, to, replyTo }, 'invoice');
    this.invoices.markCustomerEmailed(ctx, invoiceId, new Date());
    return true;
  }

  // Once per invoice: the claim and the outbox row share one transaction, so a retry finds the claim and sends nothing.
  sendAutomatic(ctx: AccountContext, invoiceId: string): boolean {
    const invoice = this.invoices.emailState(ctx, invoiceId);
    if (!invoice || invoice.origin !== 'app' || invoice.status !== 'issued') return false;
    if (invoice.customerEmailedAt) return false;
    if (!this.emitters.get(ctx, invoice.emitterId)?.autoEmailCustomer) return false;
    const to = customerEmailOf(this.deps.db, ctx, invoiceId);
    const replyTo = new MemberRepository(this.deps.db).ownerEmail(ctx);
    if (!to || !replyTo) return false;
    return this.deps.db.transaction(() => {
      if (!this.invoices.claimCustomerEmail(ctx, invoiceId, new Date())) return false;
      const mail = this.render(ctx, invoiceId);
      if (!mail) throw new Error('A claimed invoice must render.');
      this.deps.outbox.queue({ ...mail, to, replyTo }, 'invoice', new Date(), this.deps.db);
      return true;
    });
  }
}
