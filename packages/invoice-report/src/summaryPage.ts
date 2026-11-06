import type { PDFPage } from 'pdf-lib';
import { formatBrasiliaDateTime } from '@notaflow/provider-nacional';
import {
  BLUE, BORDER, CHIP, drawBox, drawLine, drawLogo, drawText, FAINT, formatCents, formatCount, formatMoney,
  HIGHLIGHT, INK, logoWidth, MUTED, NAVY, RED, RULE, textWidth, WHITE, type Fonts,
} from './draw';
import { CONTENT_RIGHT, CONTENT_WIDTH, emitterLine, MARGIN, PAGE_WIDTH, periodTypeLabel } from './pageFrame';
import { periodLabel } from './period';
import type { MonthLine, ReportInput, ReportSummary } from './types';

const HEADER_BOTTOM = 66;
const BODY_TOP = 76;
const GAP = 6;
const TILE_HEIGHT = 40;
const SECTION_HEIGHT = 12 + TILE_HEIGHT + 10;

type Tile = { label: string; formula: string; cents: number; red?: boolean; highlight?: boolean; span?: number };

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function br(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

function generatedAt(date: Date): string {
  const s = formatBrasiliaDateTime(date);
  return `Gerado em ${br(s.slice(0, 10))} às ${s.slice(11, 16)}`;
}

function drawPeriodCard(page: PDFPage, fonts: Fonts, input: ReportInput): void {
  const w = 210;
  const x = CONTENT_RIGHT - w;
  drawBox(page, x, 12, w, 46, { radius: 5, fill: BLUE });
  drawBox(page, x + 3.4, 12, w - 3.4, 46, { radius: 4, fill: WHITE, border: BORDER });
  const right = CONTENT_RIGHT - 10;
  const label = `Período · ${periodTypeLabel(input.period.type)}`.toUpperCase();
  drawText(page, label, right, 23, { font: fonts.bold, size: 6.3, color: MUTED, align: 'right' });
  drawText(page, periodLabel(input.period), right, 38, { font: fonts.display, size: 12, align: 'right' });
  const range = `Competência de ${br(input.period.from)} a ${br(input.period.to)}`;
  drawText(page, range, right, 50, { font: fonts.regular, size: 7, color: MUTED, align: 'right' });
}

function drawChip(page: PDFPage, fonts: Fonts, text: string, x: number, top: number): number {
  const w = textWidth(fonts.bold, text, 6.6) + 10;
  drawBox(page, x, top, w, 10, { radius: 5, fill: CHIP });
  drawText(page, text, x + 5, top + 7.2, { font: fonts.bold, size: 6.6, color: NAVY });
  return x + w + 4;
}

function drawHeader(page: PDFPage, fonts: Fonts, input: ReportInput, summary: ReportSummary): void {
  drawLogo(page, MARGIN, 14, 30);
  const x = MARGIN + logoWidth(30) + 12;
  const maxWidth = CONTENT_RIGHT - 210 - 12 - x;
  drawText(page, 'Relatório de NFS-e emitidas', x, 26, { font: fonts.display, size: 14, color: NAVY });
  drawText(page, emitterLine(input), x, 39, { font: fonts.bold, size: 8, width: maxWidth });
  let chipX = x;
  chipX = drawChip(page, fonts, plural(input.rows.length, 'nota', 'notas'), chipX, 45);
  chipX = drawChip(page, fonts, plural(summary.issuedCount, 'emitida', 'emitidas'), chipX, 45);
  chipX = drawChip(page, fonts, plural(summary.cancelledCount, 'cancelada', 'canceladas'), chipX, 45);
  drawText(page, generatedAt(input.generatedAt), chipX + 2, 52.2, { font: fonts.regular, size: 7, color: MUTED });
  drawPeriodCard(page, fonts, input);
  drawLine(page, 0, PAGE_WIDTH, HEADER_BOTTOM, NAVY, 1.7);
}

function drawTile(page: PDFPage, fonts: Fonts, tile: Tile, x: number, top: number, w: number): void {
  if (tile.highlight) {
    drawBox(page, x, top, w, TILE_HEIGHT, { radius: 5, fill: BLUE });
    drawBox(page, x + 3.4, top, w - 3.4, TILE_HEIGHT, { radius: 4, fill: HIGHLIGHT, border: BORDER });
  } else {
    drawBox(page, x, top, w, TILE_HEIGHT, { radius: 5, border: BORDER });
  }
  const left = x + (tile.highlight ? 11 : 8);
  const width = w - (left - x) - 8;
  drawText(page, tile.label.toUpperCase(), left, top + 11, { font: fonts.bold, size: 6.3, color: MUTED, width });
  drawText(page, tile.formula, left, top + 19, { font: fonts.regular, size: 5.6, color: FAINT, width });
  const value = { font: fonts.bold, size: 11, color: tile.red ? RED : INK, width };
  drawText(page, formatMoney(tile.cents), left, top + 33, value);
}

function drawSection(page: PDFPage, fonts: Fonts, title: string, tiles: Tile[], top: number): number {
  drawText(page, title.toUpperCase(), MARGIN, top + 7, { font: fonts.bold, size: 6.8, color: NAVY });
  const units = tiles.reduce((sum, t) => sum + (t.span ?? 1), 0);
  const unit = (CONTENT_WIDTH - GAP * (tiles.length - 1) - GAP * (units - tiles.length)) / units;
  let x = MARGIN;
  for (const tile of tiles) {
    const w = unit * (tile.span ?? 1) + GAP * ((tile.span ?? 1) - 1);
    drawTile(page, fonts, tile, x, top + 12, w);
    x += w + GAP;
  }
  return top + SECTION_HEIGHT;
}

function totalsTitle(summary: ReportSummary): string {
  const parts = ['Totais', plural(summary.issuedCount, 'nota emitida', 'notas emitidas')];
  if (summary.cancelledCount > 0)
    parts.push(plural(summary.cancelledCount, 'cancelada fora da soma', 'canceladas fora da soma'));
  return parts.join(' · ');
}

function drawCards(page: PDFPage, fonts: Fonts, summary: ReportSummary, top: number): number {
  const t = summary.totals;
  let y = drawSection(page, fonts, totalsTitle(summary), [
    { label: 'Valor serviço', formula: 'vServ', cents: t.service },
    { label: 'Valor total retenções', formula: 'vTotalRet', cents: t.totalRet, red: true },
    { label: 'Descontos', formula: 'vDescIncond + vDescCond', cents: t.discounts, red: true },
    { label: 'Valor líquido', formula: 'vLiq', cents: t.net, highlight: true },
  ], top);
  y = drawSection(page, fonts, 'Retenções', [
    { label: 'Retenção CP', formula: 'vRetCP', cents: t.retCp, red: true },
    { label: 'Retenção IRRF', formula: 'vRetIRRF', cents: t.retIrrf, red: true },
    { label: 'Retenção PIS/COFINS/CSLL', formula: 'vRetCSLL', cents: t.retCsll, red: true },
    { label: 'Retenção ISSQN', formula: 'vISSQN com tpRetISSQN 2 ou 3', cents: t.issRetained, red: true },
  ], y);
  const ibsCbs = `vIBSUF ${formatCents(t.ibsUf)} · vIBSMun ${formatCents(t.ibsMun)} · vCBS ${formatCents(t.cbs)}`;
  return drawSection(page, fonts, 'Impostos', [
    { label: 'ISSQN não retido', formula: 'vISSQN com tpRetISSQN 1', cents: t.issNotRetained },
    { label: 'PIS/COFINS operação própria', formula: 'vPis + vCofins não retidos', cents: t.ownPisCofins },
    { label: 'IBS/CBS', formula: ibsCbs, cents: t.ibsCbs, highlight: true, span: 2 },
  ], y);
}

const MONTH_ROW = 11;
const BAR_LEFT = MARGIN + 140;
const BAR_MAX = 300;
// Right edges of the number columns: Notas, Serviços, Retenções, Líquido.
const MONTH_COLS = [MARGIN + 120, MARGIN + 560, MARGIN + 680, CONTENT_RIGHT];

function drawMonthRow(page: PDFPage, fonts: Fonts, cells: string[], baseline: number, bold: boolean): void {
  const font = bold ? fonts.bold : fonts.regular;
  const [label = '', ...numbers] = cells;
  drawText(page, label, MARGIN, baseline, { font, size: 7 });
  numbers.forEach((text, i) => {
    const x = MONTH_COLS[i] ?? CONTENT_RIGHT;
    drawText(page, text, x, baseline, { font, size: 7, color: i === 2 ? RED : INK, align: 'right' });
  });
}

function drawMonths(page: PDFPage, fonts: Fonts, months: MonthLine[], summary: ReportSummary, top: number): number {
  drawText(page, 'MÊS A MÊS', MARGIN, top + 7, { font: fonts.bold, size: 6.8, color: NAVY });
  const head = { font: fonts.bold, size: 6, color: MUTED };
  let y = top + 20;
  drawText(page, 'MÊS', MARGIN, y, head);
  ['NOTAS', 'SERVIÇOS', 'RETENÇÕES', 'LÍQUIDO'].forEach((text, i) => {
    drawText(page, text, MONTH_COLS[i] ?? CONTENT_RIGHT, y, { ...head, align: 'right' });
  });
  drawLine(page, MARGIN, CONTENT_RIGHT, y + 3, INK, 0.75);
  const max = Math.max(0, ...months.map((m) => m.service));
  for (const m of months) {
    y += MONTH_ROW;
    drawMonthRow(page, fonts, [m.label, formatCount(m.count), formatCents(m.service), formatCents(m.totalRet), formatCents(m.net)], y, false);
    if (max > 0 && m.service > 0)
      drawBox(page, BAR_LEFT, y - 5.5, Math.max(1, (m.service / max) * BAR_MAX), 5, { radius: 1.5, fill: BLUE });
    drawLine(page, MARGIN, CONTENT_RIGHT, y + 3, RULE, 0.5);
  }
  y += MONTH_ROW + 1;
  drawLine(page, MARGIN, CONTENT_RIGHT, y - 8.5, INK, 0.75);
  const t = summary.totals;
  const count = months.reduce((sum, m) => sum + m.count, 0);
  drawMonthRow(page, fonts, ['Total', formatCount(count), formatCents(t.service), formatCents(t.totalRet), formatCents(t.net)], y, true);
  return y + 12;
}

function drawEmpty(page: PDFPage, fonts: Fonts, top: number): void {
  drawBox(page, MARGIN, top, CONTENT_WIDTH, 44, { radius: 5, border: FAINT, dash: [3, 2] });
  drawText(page, 'Nenhuma nota no período', MARGIN + CONTENT_WIDTH / 2, top + 25, {
    font: fonts.regular, size: 9, color: MUTED, align: 'center',
  });
}

export function drawSummaryPage(page: PDFPage, fonts: Fonts, input: ReportInput, summary: ReportSummary): void {
  drawHeader(page, fonts, input, summary);
  if (input.rows.length === 0) {
    drawEmpty(page, fonts, BODY_TOP);
    return;
  }
  let y = drawCards(page, fonts, summary, BODY_TOP);
  if (summary.months.length > 0) y = drawMonths(page, fonts, summary.months, summary, y);
  if (summary.missingXmlCount > 0) {
    const n = summary.missingXmlCount;
    const note = n === 1 ? '1 nota sem XML ficou fora dos totais' : `${formatCount(n)} notas sem XML ficaram fora dos totais`;
    drawText(page, note, MARGIN, y + 8, { font: fonts.bold, size: 7.5, color: RED });
  }
}
