import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { box, cm, drawTextAt, fitText, RED, wrapText } from './draw';
import { BLOCKS, FIELDS, type FieldKey, type LayoutField } from './layout';
import { readDanfseData, type DanfseData } from './readDanfseData';

export type DanfseMark = 'none' | 'cancelada' | 'substituida';

const QR_URL = 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';
const QR_CAPTION =
  'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e';
const PAD = 2;

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFImage;
  data: DanfseData;
}

function asset(name: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)));
}

function field(key: FieldKey): LayoutField {
  const found = FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(`Unknown DANFSe field: ${key}`);
  return found;
}

function centered(ctx: Ctx, text: string, font: PDFFont, size: number, f: LayoutField, topPt: number, color?: typeof RED): void {
  const x = cm(f.x) + (cm(f.width) - font.widthOfTextAtSize(text, size)) / 2;
  drawTextAt(ctx.page, text, font, size, x, topPt, color);
}

function drawHeader(ctx: Ctx): void {
  const { page, regular, bold, data } = ctx;
  const block = BLOCKS.find((b) => b.key === 'header');
  if (!block) throw new Error('Missing header block');
  box(page, block.x, block.y, block.width, block.height, { fill: true, lineWidth: 0.5 });

  const logo = field('logo');
  const scale = Math.min(cm(logo.width) / ctx.logo.width, cm(logo.height) / ctx.logo.height);
  page.drawImage(ctx.logo, {
    x: cm(logo.x),
    y: page.getHeight() - cm(logo.y) - ctx.logo.height * scale,
    width: ctx.logo.width * scale,
    height: ctx.logo.height * scale,
  });

  const title = field('documentTitle');
  box(page, title.x, title.y, title.width, title.height, { lineWidth: 0.5 });
  const top = cm(title.y) + 2;
  centered(ctx, 'DANFSe v2.0', bold, 9, title, top);
  centered(ctx, 'Documento Auxiliar da NFS-e', bold, 9, title, top + 10.5);
  if (data.testEnvironment) centered(ctx, 'NFS-e SEM VALIDADE JURÍDICA', bold, 9, title, top + 21, RED);

  const lines: [FieldKey, number][] = [['municipality', 8], ['generatorEnvironment', 6], ['environmentType', 6]];
  for (const [key, size] of lines) {
    const f = field(key);
    const text = data.fields[key];
    if (text === '-') continue;
    drawTextAt(page, fitText(regular, text, size, cm(f.width) - 2 * PAD), regular, size, cm(f.x) + PAD, cm(f.y) + PAD);
  }
}

function drawIdentificationField(ctx: Ctx, key: FieldKey): void {
  const f = field(key);
  box(ctx.page, f.x, f.y, f.width, f.height, { fill: key === 'issuerType', lineWidth: 0.5 });
  drawTextAt(ctx.page, f.label.toUpperCase(), ctx.bold, 7, cm(f.x) + PAD, cm(f.y) + PAD);
  const text = key === 'accessKey' ? ctx.data.accessKey : ctx.data.fields[key];
  const max = cm(f.width) - 2 * PAD;
  drawTextAt(ctx.page, fitText(ctx.regular, text, 7, max), ctx.regular, 7, cm(f.x) + PAD, cm(f.y) + PAD + 9);
}

async function drawIdentification(ctx: Ctx, doc: PDFDocument): Promise<void> {
  const { page, regular, data } = ctx;
  for (const f of FIELDS) {
    if (f.block === 'identification' && f.xmlPath !== '') drawIdentificationField(ctx, f.key);
  }

  const qr = field('qrCode');
  const png = await QRCode.toBuffer(`${QR_URL}${data.accessKey}`, { type: 'png', margin: 0 });
  const image = await doc.embedPng(png);
  page.drawImage(image, {
    x: cm(qr.x),
    y: page.getHeight() - cm(qr.y + qr.height),
    width: cm(qr.width),
    height: cm(qr.height),
  });

  const caption = field('qrCaption');
  const lines = wrapText(regular, QR_CAPTION, 6, cm(caption.width));
  lines.slice(0, 3).forEach((line, i) => {
    drawTextAt(page, line, regular, 6, cm(caption.x), cm(caption.y) + i * 7.5);
  });
}

export async function renderDanfse(xml: string, options: { mark: DanfseMark }): Promise<Uint8Array> {
  const data = readDanfseData(xml);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setProducer('NotaFlow');
  doc.setCreator('NotaFlow');
  const page = doc.addPage([595.28, 841.89]);
  const ctx: Ctx = {
    page,
    regular: await doc.embedFont(asset('LiberationSans-Regular.ttf')),
    bold: await doc.embedFont(asset('LiberationSans-Bold.ttf')),
    logo: await doc.embedPng(asset('nfse-logo-horizontal.png')),
    data,
  };

  box(page, 0.2, 0.2, 21 - 0.4, 29.7 - 0.4, { lineWidth: 1 });
  drawHeader(ctx);
  await drawIdentification(ctx, doc);
  // Task 4 draws the other blocks and the watermark for options.mark.
  void options.mark;

  return doc.save();
}
