import { danfseKey, markFor, renderDanfse } from '@notaflow/danfse-pdf';
import type { R2Client } from '@notaflow/r2';
import { buffer } from 'node:stream/consumers';

const MAX_STORED_BYTES = 2 * 1024 * 1024;

export interface DanfseSource {
  invoiceId: string;
  accessKey: string | null;
  pdfStatus: 'pending' | 'ready' | 'failed' | null;
  pdfMark: 'none' | 'cancelada' | 'substituida' | null;
  xml: string;
  status: string;
  eventCodes: string[];
}

export interface DanfseDeps {
  r2?: Pick<R2Client, 'get'> | null;
  metrics?: { danfseOnDemand(): void };
  log: { warn(bindings: object, message: string): void };
}

// The R2 object of the row's mark when ready, else drawn from the stored XML; never calls the ADN.
export async function danfsePdf(source: DanfseSource, deps: DanfseDeps): Promise<Buffer> {
  const storedMark = source.pdfStatus === 'ready' ? source.pdfMark : null;
  if (deps.r2 && storedMark && source.accessKey) {
    try {
      const stored = await deps.r2.get(danfseKey(source.accessKey, storedMark));
      if (stored && (stored.size === null || stored.size <= MAX_STORED_BYTES)) {
        // Buffered so a stream error lands here, before the 200 is committed.
        return await buffer(stored.body);
      }
    } catch (error) {
      deps.log.warn(
        { module: 'danfse', invoiceId: source.invoiceId, err: error },
        'DANFSe read from R2 failed; drawing on demand',
      );
    }
  }
  const mark = markFor(source.status, source.eventCodes);
  const pdf = await renderDanfse(source.xml, { mark });
  deps.metrics?.danfseOnDemand();
  return Buffer.from(pdf);
}

export function noticeOf(status: string, eventCodes: string[]): 'cancelada' | 'substituida' | null {
  const mark = markFor(status, eventCodes);
  return mark === 'none' ? null : mark;
}
