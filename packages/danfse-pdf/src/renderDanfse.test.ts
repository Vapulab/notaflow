import QRCode from 'qrcode';
import { grayscale, PDFPage, rgb } from 'pdf-lib';
import { expect, test, vi } from 'vitest';
import { readFixture } from '../../provider-nacional/test/fixtures';
import { cm } from './draw';
import { pdfFacts } from './pdfText.test-util';
import { qrUrl, renderDanfse } from './renderDanfse';

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

test('QR code: URL, size, and position from the NT', async () => {
  const toBuffer = vi.spyOn(QRCode, 'toBuffer');
  const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage');
  await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' });
  expect(toBuffer.mock.calls[0]?.[0]).toBe(qrUrl('35503082212345678000195000000000004226100000000420'));
  expect(qrUrl('K')).toBe('https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=K');
  const qr = drawImage.mock.calls.map((c) => c[1]).find((o) => o?.width !== undefined && Math.abs(o.width - cm(1.52)) < 0.01);
  expect(qr?.height).toBeCloseTo(cm(1.52), 2);
  expect(qr?.x).toBeCloseTo(cm(17.48), 2);
  expect(qr?.y).toBeCloseTo(841.89 - cm(1.67 + 1.52), 2);
  vi.restoreAllMocks();
});
test('test-environment line is solid red 9 pt bold; shading is gray 5%', async () => {
  const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
  const drawRectangle = vi.spyOn(PDFPage.prototype, 'drawRectangle');
  await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' });
  const red = drawText.mock.calls.find((c) => c[0] === 'NFS-e SEM VALIDADE JURÍDICA')?.[1];
  expect(red?.color).toEqual(rgb(1, 0, 0));
  expect(red?.size).toBe(9);
  expect(red?.font?.name).toContain('Bold');
  const label = drawText.mock.calls.find((c) => c[0] === 'NÚMERO DA NFS-E')?.[1];
  expect(label?.size).toBe(7);
  const shaded = drawRectangle.mock.calls.filter((c) => c[0]?.color !== undefined).map((c) => c[0]?.color);
  expect(shaded).toHaveLength(2);
  expect(shaded[0]).toEqual(grayscale(0.95));
  vi.restoreAllMocks();
});
