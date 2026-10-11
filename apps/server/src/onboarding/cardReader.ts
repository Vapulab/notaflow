import { Worker } from 'node:worker_threads';

export const MAX_CARD_BYTES = 2 * 1024 * 1024;

export interface CardText {
  cnpj: string;
  legalName: string | null;
}

export class CardError extends Error {
  constructor(readonly code: 'card_unreadable' | 'card_no_cnpj' | 'card_too_large') {
    super(code);
    this.name = 'CardError';
  }
}

// The Receita card puts each label on its own line and its value on the next one.
export function parseCardText(text: string): CardText {
  const cnpj = /\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/.exec(text);
  if (!cnpj) throw new CardError('card_no_cnpj');
  const lines = text.split('\n').map((line) => line.trim());
  const label = lines.findIndex((line) => line.toUpperCase() === 'NOME EMPRESARIAL');
  const legalName =
    label >= 0 ? (lines.slice(label + 1).find((line) => line !== '') ?? null) : null;
  return { cnpj: cnpj.slice(1).join(''), legalName };
}

function extractText(pdf: Buffer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cardWorker.ts', import.meta.url), {
      workerData: new Uint8Array(pdf),
      execArgv: ['--import', 'tsx'],
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new CardError('card_unreadable'));
    }, timeoutMs);
    worker.once('message', (text: unknown) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(typeof text === 'string' ? text : '');
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new CardError('card_unreadable'));
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new CardError('card_unreadable'));
    });
  });
}

export async function readCard(
  pdf: Buffer,
  options: { timeoutMs?: number } = {},
): Promise<CardText> {
  if (pdf.length > MAX_CARD_BYTES) throw new CardError('card_too_large');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new CardError('card_unreadable');
  const text = await extractText(pdf, options.timeoutMs ?? 5000);
  if (text.trim() === '') throw new CardError('card_unreadable');
  return parseCardText(text);
}
