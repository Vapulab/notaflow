import { Worker } from 'node:worker_threads';
import type { ReportInput, ReportPeriod } from '@notaflow/invoice-report';
import type { ReportInvoiceRow } from '../repos/ReportJobRepository';

export type ThreadInput = {
  emitter: ReportInput['emitter'];
  period: ReportPeriod;
  generatedAt: string;
  rows: ReportInvoiceRow[];
};
export type ThreadResult = { pdf: Buffer; pages: number; invoiceCount: number };

export type ThreadWireInput = Omit<ThreadInput, 'rows'> & {
  rows: (Omit<ReportInvoiceRow, 'xmlGzip'> & { xmlGzip: Uint8Array | null })[];
};

type ThreadAnswer =
  | { ok: true; pdf: Uint8Array; pages: number; invoiceCount: number }
  | { ok: false };

export class RenderTimeoutError extends Error {
  constructor() {
    super('report render timed out');
    this.name = 'RenderTimeoutError';
  }
}

export function renderInThread(
  input: ThreadInput,
  opts: { timeoutMs?: number } = {},
): Promise<ThreadResult> {
  return new Promise((resolve, reject) => {
    // Each XML gets its own ArrayBuffer so the transfer moves it without a copy.
    const transfer: ArrayBuffer[] = [];
    const rows = input.rows.map((r) => {
      if (!r.xmlGzip) return { ...r, xmlGzip: null };
      const copy = new Uint8Array(r.xmlGzip);
      transfer.push(copy.buffer);
      return { ...r, xmlGzip: copy };
    });
    const wire: ThreadWireInput = { ...input, rows };
    const worker = new Worker(new URL('./renderThread.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      workerData: wire,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
      transferList: transfer,
    });
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      outcome();
    };
    const timer = setTimeout(
      () => finish(() => reject(new RenderTimeoutError())),
      opts.timeoutMs ?? 120_000,
    );
    worker.once('message', (answer: ThreadAnswer) =>
      finish(() =>
        answer.ok
          ? resolve({
              pdf: Buffer.from(answer.pdf.buffer, answer.pdf.byteOffset, answer.pdf.byteLength),
              pages: answer.pages,
              invoiceCount: answer.invoiceCount,
            })
          : reject(new Error('render_failed')),
      ),
    );
    worker.once('error', () => finish(() => reject(new Error('render_failed'))));
    worker.once('exit', () => finish(() => reject(new Error('render_failed'))));
  });
}
