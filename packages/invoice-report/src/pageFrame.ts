import type { PDFPage } from 'pdf-lib';
import { BORDER, drawLine, drawLogo, drawText, formatDocument, logoWidth, MUTED, NAVY, textWidth, type Fonts } from './draw';
import { periodLabel, type PeriodType } from './period';
import type { ReportInput } from './types';

export const PAGE_WIDTH = 842;
export const PAGE_HEIGHT = 595;
export const MARGIN = 20;
export const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
export const FOOTER_TOP = PAGE_HEIGHT - 24;
export const LIST_HEADER_BOTTOM = 34;

export const FOOTER_TEXT = 'Gerado por NotaFlow · notaflow.vapulab.com · Relatório sem valor fiscal';

const PERIOD_TYPES: Record<PeriodType, string> = { month: 'Mensal', year: 'Anual', range: 'Por período' };

export function periodTypeLabel(type: PeriodType): string {
  return PERIOD_TYPES[type];
}

export function emitterLine(input: ReportInput): string {
  return `${input.emitter.legalName} · ${formatDocument(input.emitter.cnpj)}`;
}

export function drawListHeader(page: PDFPage, fonts: Fonts, input: ReportInput): void {
  drawLogo(page, MARGIN, 9, 18);
  const titleX = MARGIN + logoWidth(18) + 9;
  const title = 'Relatório de NFS-e';
  drawText(page, title, titleX, 23, { font: fonts.display, size: 10.5, color: NAVY });
  const right = `${periodTypeLabel(input.period.type)} · ${periodLabel(input.period)}`;
  const rightWidth = textWidth(fonts.regular, right, 7.5);
  const nameX = titleX + textWidth(fonts.display, title, 10.5) + 12;
  drawText(page, emitterLine(input), nameX, 22.5, {
    font: fonts.regular,
    size: 7.5,
    width: CONTENT_RIGHT - rightWidth - 16 - nameX,
  });
  drawText(page, right, CONTENT_RIGHT, 22.5, { font: fonts.regular, size: 7.5, color: MUTED, align: 'right' });
  drawLine(page, 0, PAGE_WIDTH, LIST_HEADER_BOTTOM, NAVY, 1.7);
}

export function drawFooter(page: PDFPage, fonts: Fonts, input: ReportInput, number: number, total: number): void {
  drawLine(page, 0, PAGE_WIDTH, FOOTER_TOP, BORDER, 0.85);
  drawLogo(page, MARGIN, FOOTER_TOP + 6, 12);
  const opts = { font: fonts.regular, size: 6.8, color: MUTED };
  drawText(page, FOOTER_TEXT, MARGIN + logoWidth(12) + 8, FOOTER_TOP + 15, opts);
  const right = `${input.emitter.shortName} · ${periodLabel(input.period)} · Página ${number} de ${total}`;
  drawText(page, right, CONTENT_RIGHT, FOOTER_TOP + 15, { ...opts, align: 'right' });
}
