import QRCode from 'qrcode';
import { degrees, grayscale, PDFPage, rgb } from 'pdf-lib';
import { afterEach, expect, test, vi } from 'vitest';
import { readFixture } from '../../provider-nacional/test/fixtures';
import { cm } from './draw';
import { pdfFacts } from './pdfText.test-util';
import { qrUrl, renderDanfse } from './renderDanfse';

afterEach(() => {
  vi.restoreAllMocks();
});

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
  expect(shaded.length).toBeGreaterThanOrEqual(2);
  for (const color of shaded) expect(color).toEqual(grayscale(0.95));
});

test('watermarks', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'cancelada' }))).text).toContain('CANCELADA');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'substituida' }))).text).toContain('SUBSTITUÍDA');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'none' }))).text).not.toMatch(/CANCELADA|SUBSTITUÍDA/);
});
test('the watermark is 60 pt gray K35, rotated 45 degrees, and drawn last', async () => {
  const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
  await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'cancelada' });
  const last = drawText.mock.calls[drawText.mock.calls.length - 1];
  expect(last?.[0]).toBe('CANCELADA');
  expect(last?.[1]?.size).toBe(60);
  expect(last?.[1]?.color).toEqual(grayscale(0.65));
  expect(last?.[1]?.rotate).toEqual(degrees(45));
});
test('fixed texts for absent blocks', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<toma>[\s\S]*?<\/toma>/, '');
  const { text } = await pdfFacts(await renderDanfse(xml, { mark: 'none' }));
  expect(text).toContain('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
  expect(text).toContain('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
});
test('the recipient is the customer: note 3 text; absent recipient: note 2 text', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'none' }))).text).toContain('O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO');
  const none = xml.replace(/<toma>[\s\S]*?<\/toma>/, '');
  expect((await pdfFacts(await renderDanfse(none, { mark: 'none' }))).text).toContain('DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
});
test('ISSQN not applicable prints the fixed text', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace('<tribISSQN>1</tribISSQN>', '<tribISSQN>4</tribISSQN>');
  const { text } = await pdfFacts(await renderDanfse(xml, { mark: 'none' }));
  expect(text).toContain('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN');
});
test('a 2000-character description stays on one page', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<xDescServ>[^<]*<\/xDescServ>/, `<xDescServ>${'Serviço '.repeat(250)}</xDescServ>`);
  const f = await pdfFacts(await renderDanfse(xml, { mark: 'none' }));
  expect(f.pages).toBe(1);
  expect(f.text).toContain('...');
});
test('tax totals line is always present', async () => {
  const { text } = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(text).toContain('Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012');
});
test('block titles are bold uppercase and the net amount with IBS/CBS is shaded', async () => {
  const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
  const drawRectangle = vi.spyOn(PDFPage.prototype, 'drawRectangle');
  await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' });
  const title = drawText.mock.calls.find((c) => c[0] === 'SERVIÇO PRESTADO')?.[1];
  expect(title?.size).toBe(7);
  expect(title?.font?.name).toContain('Bold');
  const label = drawText.mock.calls.find((c) => c[0] === 'Valor Líquido da NFS-e + IBS/CBS')?.[1];
  expect(label?.size).toBe(6);
  const shaded = drawRectangle.mock.calls.filter((c) => c[0]?.color !== undefined);
  expect(shaded.length).toBeGreaterThan(10);
});
