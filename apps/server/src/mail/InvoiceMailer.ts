import type { AccountContext } from '@notaflow/core';
import { parseNfseXml } from '@notaflow/provider-nacional';
import type { Database } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceLinkRepository } from '../repos/InvoiceLinkRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { AuditLog } from '../repos/AuditLog';
import { MemberRepository } from '../repos/MemberRepository';
import { HttpError } from '../httpError';
import { MailSuppressionRepository } from '../repos/MailSuppressionRepository';
import { isEmailAddress } from './address';
import { invoiceUnsubscribeUrl } from './invoiceUnsubscribe';
import type { MailOutbox } from './outbox';
import { type Unsuppress, unsuppressFailure } from './resendSuppressions';
import { invoiceEmail } from './templates';

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
const UNBLOCK_WINDOW_MS = 30 * DAY_MS;

export class InvoiceMailer {
  private readonly invoices: InvoiceRepository;
  private readonly emitters: EmitterRepository;
  private readonly links: InvoiceLinkRepository;
  private readonly suppressions: MailSuppressionRepository;
  private readonly audit: AuditLog;

  constructor(
    private readonly deps: {
      db: Database;
      outbox: MailOutbox;
      appOrigin: string;
      secret: string;
      unsuppress: Unsuppress;
      log?: (line: string) => void;
    },
  ) {
    this.invoices = new InvoiceRepository(deps.db);
    this.emitters = new EmitterRepository(deps.db);
    this.links = new InvoiceLinkRepository(deps.db);
    this.suppressions = new MailSuppressionRepository(deps.db);
    this.audit = new AuditLog(deps.db);
  }

  // Null when the invoice cannot be shared yet.
  private render(ctx: AccountContext, invoiceId: string, to: string) {
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
      unsubscribeUrl: invoiceUnsubscribeUrl(this.deps.appOrigin, to, this.deps.secret),
      test: invoice.environment === 'producao_restrita',
    });
  }

  // Sent now; a failed delivery stays in the outbox for the retries.
  async sendByHand(
    ctx: AccountContext,
    invoiceId: string,
    to: string,
    replyTo: string,
    options: { confirmAddress?: boolean } = {},
  ): Promise<'sent' | 'suppressed' | 'unblocked' | false> {
    const mail = this.render(ctx, invoiceId, to);
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
    const reason = this.suppressions.reasonOf(to, 'invoice');
    let unblocked = false;
    if (reason === 'bounce') {
      if (!options.confirmAddress) throw new HttpError(409, 'email_invalid_address');
      // Across all accounts: the do-not-send list is shared, so one emitter cannot unblock it again and again.
      if (this.suppressions.unblockedRecently(to, 'invoice', new Date(now - UNBLOCK_WINDOW_MS))) {
        throw new HttpError(409, 'email_invalid_address_final');
      }
      let resend: 'removed' | 'complaint';
      try {
        resend = await this.deps.unsuppress(to.trim().toLowerCase());
      } catch (error) {
        this.deps.log?.(`Resend unsuppress failed: ${unsuppressFailure(error)}`);
        throw new HttpError(502, 'email_unblock_failed');
      }
      if (resend === 'complaint') {
        this.suppressions.add(to, 'invoice', 'complaint');
        outbox.cancelPendingInvoice(to);
        return 'suppressed';
      }
      this.suppressions.unblock(to, 'invoice', ctx);
      unblocked = true;
    } else if (reason) {
      // Answered like a send, so the reply never tells a caller whether an address unsubscribed.
      return 'suppressed';
    }
    await outbox.send(
      { ...mail, to, replyTo, ref: { accountId: ctx.accountId, invoiceId } },
      'invoice',
    );
    this.invoices.markCustomerEmailed(ctx, invoiceId, new Date());
    return unblocked ? 'unblocked' : 'sent';
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
    const reason = this.suppressions.reasonOf(to, 'invoice');
    if (reason === 'bounce') {
      // A row with no claim, so the invoice detail can warn the emitter that the address is dead.
      this.deps.outbox.recordBlocked({
        to,
        subject: '',
        ref: { accountId: ctx.accountId, invoiceId },
      });
      this.audit.record({
        userEmail: replyTo,
        accountId: ctx.accountId,
        action: 'invoice.email',
        entity: invoiceId,
        result: 'refused',
        detail: `automatic skipped, address bounced @${to.split('@')[1] ?? ''}`,
      });
      return false;
    }
    if (reason) return false;
    return this.deps.db.transaction(() => {
      // Skipped before the claim, so the invoice can still be sent by hand.
      if (
        this.deps.outbox.countInvoiceMail(
          { accountId: ctx.accountId },
          new Date(Date.now() - HOUR_MS),
        ) >= PER_HOUR
      ) {
        this.audit.record({
          userEmail: replyTo,
          accountId: ctx.accountId,
          action: 'invoice.email',
          entity: invoiceId,
          result: 'refused',
          detail: `automatic skipped, hourly limit @${to.split('@')[1] ?? ''}`,
        });
        return false;
      }
      if (!this.invoices.claimCustomerEmail(ctx, invoiceId, new Date())) return false;
      const mail = this.render(ctx, invoiceId, to);
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
