import type { PDFFont, PDFPage } from 'pdf-lib';
import { box, cm, drawField, drawTextAt, fitText, wrapText } from './draw';
import { BLOCKS, FIELDS, type FieldKey, type LayoutBlock, type LayoutField } from './layout';
import type { DanfseData } from './readDanfseData';

export interface BlockCtx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  data: DanfseData;
}

export const SHADED: ReadonlySet<FieldKey> = new Set(['issuerType', 'netAmountWithIbsCbs']);

const PAD = 2;
const LINE = 8.5;
// A 7 pt line needs its baseline (7 pt) plus the descender (1.5 pt) inside the box.
const LINE_EXTENT = 8.5;
// Absorbs the cm round trip, which turns 5 lines into 4.999999999999999.
const EPSILON = 1e-6;

export function linesFitting(heightPt: number): number {
  return Math.max(1, Math.floor((heightPt - LINE_EXTENT) / LINE + EPSILON) + 1);
}
const FIXED_HEIGHT = 0.32;
// The Canhoto block (y 28.10, height 0.67) is not printed, so its bottom edge is where the content ends.
const CONTENT_BOTTOM = 28.77;
const TITLE_WIDTH = 5.09;
const NOT_SUBJECT = 'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN';

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

function fixedText(block: LayoutBlock, data: DanfseData): string | undefined {
  switch (block.key) {
    case 'customer':
      return data.customer === 'absent' ? 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' : undefined;
    case 'recipient':
      if (data.recipient === 'same') return 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO';
      return data.recipient === 'absent' ? 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' : undefined;
    case 'intermediary':
      return data.intermediary === 'absent' ? 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' : undefined;
    case 'issqn':
      return data.issqn === 'notSubject' ? NOT_SUBJECT : undefined;
    default:
      return undefined;
  }
}

// Lines that fit; the last one ends with "..." when the text needs more.
export function fitLines(font: PDFFont, text: string, size: number, widthPt: number, maxLines: number): string[] {
  const lines = wrapText(font, flat(text), size, widthPt);
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept.length - 1;
  const tail = kept[last] ?? '';
  kept[last] = fitText(font, lines.length > kept.length ? `${tail}...` : tail, size, widthPt);
  return kept;
}

function drawLines(ctx: BlockCtx, lines: readonly string[], xPt: number, topPt: number): void {
  lines.forEach((line, i) => drawTextAt(ctx.page, line, ctx.regular, 7, xPt, topPt + i * LINE));
}

interface Placed {
  block: LayoutBlock;
  dy: number;
  height: number;
  fixed: string | undefined;
}

function plan(ctx: BlockCtx): Placed[] {
  const blocks = BLOCKS.filter((b) => b.key !== 'header' && b.key !== 'identification');
  const complementaryWidth = cm(20.4) - 2 * PAD;
  const complementaryLines = wrapText(ctx.regular, flat(ctx.data.fields.complementaryInfo), 7, complementaryWidth).length;
  const complementaryGrow = Math.max(0, (complementaryLines * LINE + 2 * PAD) / cm(1) - 0.39);

  let saved = 0;
  const placed = blocks.map((block): Placed => {
    const fixed = fixedText(block, ctx.data);
    const height = fixed === undefined ? block.height : FIXED_HEIGHT;
    const entry = { block, dy: -saved, height, fixed };
    saved += block.height - height;
    return entry;
  });

  const last = placed[placed.length - 1];
  if (!last) return placed;
  const end = last.block.y + last.dy + last.height + complementaryGrow;
  const serviceGrow = Math.max(0, CONTENT_BOTTOM - end);
  let afterService = false;
  for (const p of placed) {
    if (afterService) p.dy += serviceGrow;
    if (p.block.key === 'service') {
      p.height += serviceGrow;
      afterService = true;
    }
    if (p.block.key === 'complementary') p.height += complementaryGrow;
  }
  return placed;
}

function drawTitleCell(ctx: BlockCtx, title: string, y: number, height: number): void {
  box(ctx.page, 0.3, y, TITLE_WIDTH, height, { fill: true, lineWidth: 0.5 });
  const lines = wrapText(ctx.bold, title.toUpperCase(), 7, cm(TITLE_WIDTH) - 2 * PAD);
  lines.forEach((line, i) => drawTextAt(ctx.page, line, ctx.bold, 7, cm(0.3) + PAD, cm(y) + PAD + i * 7.5));
}

function drawFixed(ctx: BlockCtx, p: Placed, text: string): void {
  const y = p.block.y + p.dy;
  box(ctx.page, 0.3, y, 20.4, p.height, { lineWidth: 0.5 });
  // Cap height 5 pt and descender 1.5 pt are centered in the box.
  drawTextAt(ctx.page, text, ctx.bold, 7, cm(0.3) + PAD, cm(y) + (cm(p.height) + 3.5) / 2 - 7);
}

function drawComplementary(ctx: BlockCtx, p: Placed, f: LayoutField): void {
  const { page, regular, bold, data } = ctx;
  const y = p.block.y + p.dy;
  const strip = 0.41;
  box(page, 0.3, y, 20.4, strip, { fill: true, lineWidth: 0.5 });
  drawTextAt(page, p.block.title.toUpperCase(), bold, 7, cm(0.3) + PAD, cm(y) + PAD);
  const contentY = y + strip;
  const contentHeight = p.height - strip;
  box(page, 0.3, contentY, 20.4, contentHeight, { lineWidth: 0.5 });
  const maxLines = linesFitting(cm(contentHeight) - 2 * PAD);
  drawLines(ctx, fitLines(regular, data.fields[f.key], 7, cm(20.4) - 2 * PAD, maxLines), cm(0.3) + PAD, cm(contentY) + PAD);
}

function drawFull(ctx: BlockCtx, p: Placed): void {
  const { page, regular, bold, data } = ctx;
  const { block, dy } = p;
  const fields = FIELDS.filter((f) => f.block === block.key);

  if (block.key === 'complementary') {
    const f = fields[0];
    if (f) drawComplementary(ctx, p, f);
    return;
  }

  const first = fields.reduce<LayoutField | undefined>((a, f) => (f.x > 0.3 && (!a || f.y < a.y) ? f : a), undefined);
  drawTitleCell(ctx, block.title, block.y + dy, first?.height ?? 0.63);

  for (const f of fields) {
    // The NT puts "Tipo de Tributação do ISSQN" on the title cell; it moves to the free slot at the end of the row.
    const placed = { ...f, y: f.y + dy, x: f.key === 'issqnTaxation' ? 15.62 : f.x };
    const value = flat(data.fields[f.key]);
    if (f.key === 'serviceTaxCodeDescription') {
      box(page, placed.x, placed.y, placed.width, placed.height, { lineWidth: 0.5 });
      drawTextAt(page, fitText(regular, value, 7, cm(placed.width) - 2 * PAD), regular, 7, cm(placed.x) + PAD, cm(placed.y) + PAD);
    } else if (f.key === 'serviceDescription') {
      const height = p.height - (f.y - block.y);
      box(page, placed.x, placed.y, placed.width, height, { lineWidth: 0.5 });
      drawTextAt(page, f.label, bold, 6, cm(placed.x) + PAD, cm(placed.y) + PAD);
      const top = cm(placed.y) + PAD + 6 + 2;
      const maxLines = linesFitting(cm(placed.y + height) - top);
      drawLines(ctx, fitLines(regular, value, 7, cm(placed.width) - 2 * PAD, maxLines), cm(placed.x) + PAD, top);
    } else {
      drawField(page, ctx, placed, value, { labelSize: 6, upper: false, fill: SHADED.has(f.key) });
    }
  }
}

export function drawBlocks(ctx: BlockCtx): void {
  for (const p of plan(ctx)) {
    if (p.fixed === undefined) drawFull(ctx, p);
    else drawFixed(ctx, p, p.fixed);
  }
}
