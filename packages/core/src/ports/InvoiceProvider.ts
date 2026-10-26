import type { ProviderEvent, ProviderInvoice } from '../domain/ProviderInvoice';

export type SyncDocument =
  | { kind: 'invoice'; nsu: number; invoice: ProviderInvoice }
  | { kind: 'event'; nsu: number; event: ProviderEvent }
  | { kind: 'skipped'; nsu: number; reason: string };

export interface SyncBatch {
  documents: SyncDocument[];
  // The cursor to store with this batch; equal to the input NSU when the batch is empty.
  lastNsu: number;
  hasMore: boolean;
}

export interface InvoiceProvider {
  checkConnection(municipality: string): Promise<void>;
  fetchSince(nsu: number): Promise<SyncBatch>;
  getInvoice(accessKey: string): Promise<ProviderInvoice | null>;
}

export function isSyncInvoice(
  document: SyncDocument,
): document is Extract<SyncDocument, { kind: 'invoice' }> {
  return document.kind === 'invoice';
}
