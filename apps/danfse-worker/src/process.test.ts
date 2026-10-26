import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { R2Client } from '@notaflow/r2';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from 'vitest';
import { readFixture } from '../../../packages/provider-nacional/test/fixtures';
import { type DanfseJob, processJob } from './process';

const KEY = '35503082212345678000195000000000004226100000000420';

function fakeR2() {
  const puts: { key: string; body: Buffer; contentType: string }[] = [];
  const r2: R2Client = {
    async put(key, body, contentType) {
      puts.push({ key, body, contentType });
    },
    async get() {
      return null;
    },
    async delete() {},
  };
  return { r2, puts };
}

const job = (xml: string, over: Partial<DanfseJob> = {}): DanfseJob => ({
  invoiceId: 'inv-1',
  accessKey: KEY,
  mark: 'none',
  xmlGzipBase64: gzipSync(xml).toString('base64'),
  ...over,
});

test('puts one one-page PDF at danfse/<accessKey>.pdf', async () => {
  const { r2, puts } = fakeR2();
  const times = [1000, 1250];
  const result = await processJob(
    job(readFixture('NFSE_DOMESTIC.xml')),
    r2,
    () => times.shift() ?? 0,
  );
  expect(puts).toHaveLength(1);
  expect(puts[0]?.key).toBe(`danfse/${KEY}.pdf`);
  expect(puts[0]?.contentType).toBe('application/pdf');
  expect((await PDFDocument.load(puts[0]?.body ?? Buffer.alloc(0))).getPageCount()).toBe(1);
  expect(result).toEqual({ renderMs: 250, bytes: puts[0]?.body.length });
});

test('a bad XML throws so BullMQ retries', async () => {
  const { r2, puts } = fakeR2();
  await expect(processJob(job('<nope/>'), r2)).rejects.toThrow();
  expect(puts).toHaveLength(0);
});

test('a malformed payload is unrecoverable', async () => {
  const { r2 } = fakeR2();
  const bad = { invoiceId: 'x', mark: 'none' } as unknown as DanfseJob;
  await expect(processJob(bad, r2)).rejects.toMatchObject({ name: 'UnrecoverableError' });
  await expect(processJob(job('<a/>', { mark: 'bogus' as never }), r2)).rejects.toMatchObject({
    name: 'UnrecoverableError',
  });
});

test('the job fields match the server queue', () => {
  const server = readFileSync(new URL('../../server/src/danfse/queue.ts', import.meta.url), 'utf8');
  const block = /export interface DanfseJob \{([^}]*)\}/.exec(server)?.[1] ?? '';
  const fields = [...block.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
  expect(fields).toEqual(['accessKey', 'invoiceId', 'mark', 'xmlGzipBase64']);
});
