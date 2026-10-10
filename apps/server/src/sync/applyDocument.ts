import type { AccountContext, SyncDocument } from '@notaflow/core';
import type { CustomerRepository } from '../repos/CustomerRepository';
import type { InvoiceRepository } from '../repos/InvoiceRepository';
import type { ServiceRepository } from '../repos/ServiceRepository';
import { serviceFromInvoice } from './serviceFromInvoice';

export interface ApplyCounts {
  invoices: number;
  events: number;
  skipped: number;
}

export function applyDocument(
  repos: {
    customers: CustomerRepository;
    invoices: InvoiceRepository;
    services: ServiceRepository;
  },
  ctx: AccountContext,
  emitterId: string,
  document: SyncDocument,
  counts: ApplyCounts,
): void {
  if (document.kind === 'invoice') {
    const { customer } = document.invoice;
    const customerId = customer ? repos.customers.upsertImported(ctx, emitterId, customer) : null;
    repos.invoices.upsertSynced(ctx, emitterId, document.invoice, customerId);
    const service = serviceFromInvoice(document.invoice);
    repos.services.importService(ctx, emitterId, service.input, service.importKey);
    counts.invoices++;
  } else if (document.kind === 'event') {
    repos.invoices.recordEvent(ctx, emitterId, document.event);
    counts.events++;
  } else {
    counts.skipped++;
  }
}
