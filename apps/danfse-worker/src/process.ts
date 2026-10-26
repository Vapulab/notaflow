import { gunzipSync } from 'node:zlib';
import { type DanfseMark, renderDanfse } from '@notaflow/danfse-pdf';
import type { R2Client } from '@notaflow/r2';
import { UnrecoverableError } from 'bullmq';

// A copy of the server's job payload, so the worker stays free of server code.
export interface DanfseJob {
  invoiceId: string;
  accessKey: string;
  mark: DanfseMark;
  xmlGzipBase64: string;
}

const MARKS: readonly string[] = ['none', 'cancelada', 'substituida'];

function assertJob(job: DanfseJob): void {
  const { accessKey, mark, xmlGzipBase64, invoiceId } = job ?? {};
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  // A retry cannot fix a bad payload, so it goes straight to the DLQ.
  if (!text(invoiceId) || !text(accessKey) || !text(xmlGzipBase64) || !MARKS.includes(mark)) {
    throw new UnrecoverableError('Malformed DANFSe job payload');
  }
  // The key becomes an R2 object path.
  if (!/^[0-9A-Za-z]+$/.test(accessKey)) throw new UnrecoverableError('Malformed access key');
}

const MAX_MESSAGE = 200;

// Messages are logged and become the failed reason in Redis, so a library dump must not pass whole.
export function clip(message: string): string {
  return message.length > MAX_MESSAGE ? message.slice(0, MAX_MESSAGE) : message;
}

export async function processJob(
  job: DanfseJob,
  r2: R2Client,
  now: () => number = Date.now,
): Promise<{ renderMs: number; bytes: number }> {
  try {
    return await run(job, r2, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length <= MAX_MESSAGE && error instanceof Error) throw error;
    const Clipped = error instanceof UnrecoverableError ? UnrecoverableError : Error;
    throw new Clipped(clip(message));
  }
}

async function run(
  job: DanfseJob,
  r2: R2Client,
  now: () => number = Date.now,
): Promise<{ renderMs: number; bytes: number }> {
  assertJob(job);
  const start = now();
  const xml = gunzipSync(Buffer.from(job.xmlGzipBase64, 'base64')).toString('utf8');
  const pdf = Buffer.from(await renderDanfse(xml, { mark: job.mark }));
  const renderMs = now() - start;
  await r2.put(`danfse/${job.accessKey}.pdf`, pdf, 'application/pdf');
  return { renderMs, bytes: pdf.length };
}
