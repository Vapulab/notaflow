import { gzipSync } from 'node:zlib';
import { extractText } from 'unpdf';
import { describe, expect, test } from 'vitest';
import { readFixture } from '../../../../packages/provider-nacional/test/fixtures';
import type { ReportInvoiceRow } from '../repos/ReportJobRepository';
import {
  RenderFailedError,
  RenderTimeoutError,
  renderInThread,
  stackFrames,
  type ThreadInput,
} from './renderInThread';

const base = {
  emitter: { legalName: 'EMPRESA TESTE LTDA', cnpj: '12345678000195', shortName: 'EMPRESA TESTE' },
  period: { type: 'month', from: '2026-10-01', to: '2026-10-31' },
  generatedAt: '2026-11-06T12:00:00.000Z',
} as const;

const row = (n: number, xml: string): ReportInvoiceRow => ({
  status: 'issued',
  number: String(n),
  customerName: 'Cliente',
  customerDocument: '12345678909',
  xmlGzip: gzipSync(xml),
});

const input = (rows: ReportInvoiceRow[]): ThreadInput => ({ ...base, rows });
const textOf = async (pdf: Buffer) =>
  (await extractText(new Uint8Array(pdf), { mergePages: true })).text;

describe('renderInThread', () => {
  test('renders in a thread', async () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    const result = await renderInThread(input([1, 2, 3].map((n) => row(n, xml))));
    expect(result.invoiceCount).toBe(3);
    expect(result.pages).toBeGreaterThanOrEqual(2);
    expect(result.pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 30_000);

  test('treats a bad XML as missing', async () => {
    const result = await renderInThread(input([row(1, '<x/>')]));
    expect(await textOf(result.pdf)).toContain('1 nota sem XML ficou fora dos totais');
  }, 30_000);

  test('a thread error comes back with its type and code lines, never its message', async () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    const broken = { ...input([row(1, xml)]), emitter: null as never };
    const error: unknown = await renderInThread(broken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailedError);
    const failed = error as RenderFailedError;
    expect(failed.reason).toBe('exception');
    expect(failed.message).toBe('report render failed: exception (TypeError)');
    expect(failed.stack).toMatch(/\n\s+at /);
    expect(failed.stack).not.toContain('legalName');
  }, 30_000);

  test('stackFrames keeps only the code lines', () => {
    const error = new Error('Cliente Secreto 12345678909');
    const frames = stackFrames(error);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.join('\n')).not.toContain('Cliente Secreto');
    expect(stackFrames('text')).toEqual([]);
  });

  test('times out', async () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    await expect(renderInThread(input([row(1, xml)]), { timeoutMs: 1 })).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );
  });
});
