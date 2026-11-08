import { parentPort, workerData } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { type ReportRow, renderReport } from '@notaflow/invoice-report';
import { readReportFields } from '@notaflow/provider-nacional';
import { stackFrames, type ThreadAnswer, type ThreadWireInput } from './renderInThread';

function fieldsOf(xmlGzip: Uint8Array | null): ReportRow['fields'] {
  if (!xmlGzip) return null;
  try {
    return readReportFields(gunzipSync(xmlGzip).toString('utf8'));
  } catch {
    return null;
  }
}

async function main(input: ThreadWireInput) {
  const rows: ReportRow[] = input.rows.map((r) => ({
    status: r.status,
    number: r.number,
    customerName: r.customerName,
    customerDocument: r.customerDocument,
    fields: fieldsOf(r.xmlGzip),
  }));
  const { pdf, pages } = await renderReport({
    emitter: input.emitter,
    period: input.period,
    generatedAt: new Date(input.generatedAt),
    rows,
  });
  const copy = new Uint8Array(pdf);
  parentPort?.postMessage({ ok: true, pdf: copy, pages, invoiceCount: rows.length }, [copy.buffer]);
}

// The answer never carries the error text: it may hold row data.
main(workerData as ThreadWireInput).catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : typeof error;
  const answer: ThreadAnswer = { ok: false, errorType, frames: stackFrames(error) };
  parentPort?.postMessage(answer);
});
