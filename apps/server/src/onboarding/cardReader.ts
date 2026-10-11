import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_CARD_BYTES = 2 * 1024 * 1024;
// A Receita card has about 2 kB of text; anything near this is not a card.
export const MAX_CARD_TEXT = 64 * 1024;
const MAX_PARALLEL = 2;
const CHILD_HEAP_MB = 128;

export interface CardText {
  cnpj: string;
  legalName: string | null;
}

export class CardError extends Error {
  constructor(readonly code: 'card_unreadable' | 'card_no_cnpj' | 'card_too_large' | 'card_busy') {
    super(code);
    this.name = 'CardError';
  }
}

// The Receita card puts each label on its own line and its value on the next one.
// The CNPJ may be alphanumeric (since 2026): twelve [0-9A-Z] and two check digits.
export function parseCardText(text: string): CardText {
  if (text.length > MAX_CARD_TEXT) throw new CardError('card_unreadable');
  const cnpj = /\b([0-9A-Z]{2})\.([0-9A-Z]{3})\.([0-9A-Z]{3})\/([0-9A-Z]{4})-(\d{2})\b/.exec(text);
  if (!cnpj) throw new CardError('card_no_cnpj');
  const lines = text.split('\n').map((line) => line.trim());
  const label = lines.findIndex((line) => line.toUpperCase() === 'NOME EMPRESARIAL');
  const legalName =
    label >= 0 ? (lines.slice(label + 1).find((line) => line !== '') ?? null) : null;
  return { cnpj: cnpj.slice(1).join(''), legalName };
}

let running = 0;

type ChildAnswer = { ok: true; card: CardText } | { ok: false; code: CardError['code'] };

function parseInChild(pdf: Buffer, timeoutMs: number): Promise<CardText> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./cardProcess.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx', `--max-old-space-size=${CHILD_HEAP_MB}`],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      outcome();
    };
    const timer = setTimeout(
      () => finish(() => reject(new CardError('card_unreadable'))),
      timeoutMs,
    );
    child.once('message', (answer: ChildAnswer) =>
      finish(() => (answer.ok ? resolve(answer.card) : reject(new CardError(answer.code)))),
    );
    child.once('error', () => finish(() => reject(new CardError('card_unreadable'))));
    child.once('exit', () => finish(() => reject(new CardError('card_unreadable'))));
    child.send({ pdfBase64: pdf.toString('base64') });
  });
}

export async function readCard(
  pdf: Buffer,
  options: { timeoutMs?: number } = {},
): Promise<CardText> {
  if (pdf.length > MAX_CARD_BYTES) throw new CardError('card_too_large');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new CardError('card_unreadable');
  // A small server: two parses at a time, and the next one is told to retry rather than queue.
  if (running >= MAX_PARALLEL) throw new CardError('card_busy');
  running += 1;
  try {
    return await parseInChild(pdf, options.timeoutMs ?? 10_000);
  } finally {
    running -= 1;
  }
}
