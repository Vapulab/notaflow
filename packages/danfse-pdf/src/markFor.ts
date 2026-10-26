import type { DanfseMark } from './renderDanfse';

// 105102 is the cancellation-by-substitution event (see CANCELLING_EVENTS in InvoiceRepository).
export function markFor(status: string, eventCodes: readonly string[]): DanfseMark {
  if (status !== 'cancelled') return 'none';
  return eventCodes.includes('105102') ? 'substituida' : 'cancelada';
}
