import { expect, test } from 'vitest';
import { readFixture } from '../../provider-nacional/test/fixtures';
import { pdfFacts } from './pdfText.test-util';
import { renderDanfse } from './renderDanfse';

test('one A4 portrait page with NotaFlow metadata', async () => {
  const f = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(f.pages).toBe(1);
  expect(f.width).toBeCloseTo(595.28, 1);
  expect(f.height).toBeCloseTo(841.89, 1);
  expect(f.producer).toBe('NotaFlow');
});
test('header and identification', async () => {
  const { text } = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(text).toContain('DANFSe v2.0');
  expect(text).toContain('Documento Auxiliar da NFS-e');
  expect(text).toContain('35503082212345678000195000000000004226100000000420');
  expect(text).toContain('A autenticidade desta NFS-e');
  expect(text).toContain('portal nacional da NFS-e');
});
test('test environment prints SEM VALIDADE JURÍDICA; production does not', async () => {
  expect((await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }))).text).toContain('NFS-e SEM VALIDADE JURÍDICA');
  expect((await pdfFacts(await renderDanfse(readFixture('NFSE_EXPORT.xml'), { mark: 'none' }))).text).not.toContain('SEM VALIDADE');
});
