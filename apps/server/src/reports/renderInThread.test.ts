import { gzipSync } from 'node:zlib';
import { extractText } from 'unpdf';
import { describe, expect, test } from 'vitest';
import { readFixture } from '../../../../packages/provider-nacional/test/fixtures';
import type { ReportInvoiceRow } from '../repos/ReportJobRepository';
import { RenderTimeoutError, renderInThread, type ThreadInput } from './renderInThread';

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

  test('times out', async () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    await expect(renderInThread(input([row(1, xml)]), { timeoutMs: 1 })).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );
  });
});
