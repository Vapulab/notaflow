import { grayscale, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PT_PER_CM = 28.3465;

export function cm(value: number): number {
  return value * PT_PER_CM;
}

export const BLACK = rgb(0, 0, 0);
export const RED = rgb(1, 0, 0);
const LIGHT_GRAY = grayscale(0.95);

// Boxes take the NT coordinates (cm from the top-left) and flip them to the pdf-lib origin.
export function box(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: boolean; lineWidth: 0.5 | 1 },
): void {
  page.drawRectangle({
    x: cm(x),
    y: page.getHeight() - cm(y + h),
    width: cm(w),
    height: cm(h),
    borderWidth: opts.lineWidth,
    borderColor: BLACK,
    ...(opts.fill ? { color: LIGHT_GRAY } : {}),
  });
}

export function fitText(font: PDFFont, text: string, size: number, maxWidthPt: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidthPt) return text;
  const chars = [...text];
  while (chars.length > 0 && font.widthOfTextAtSize(`${chars.join('')}...`, size) > maxWidthPt) chars.pop();
  return `${chars.join('')}...`;
}

export function wrapText(font: PDFFont, text: string, size: number, maxWidthPt: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && font.widthOfTextAtSize(next, size) > maxWidthPt) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

// topCm is the top of the text line in NT coordinates; the baseline sits one font size below it.
export function drawTextAt(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  xPt: number,
  topPt: number,
  color = BLACK,
): void {
  page.drawText(text, { x: xPt, y: page.getHeight() - topPt - size, size, font, color });
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export interface FieldStyle {
  labelSize: number;
  upper: boolean;
  fill: boolean;
}

// One boxed field: label on top, content below, cut to the box width.
export function drawField(
  page: PDFPage,
  fonts: Fonts,
  f: { label: string; x: number; y: number; width: number; height: number },
  value: string,
  style: FieldStyle,
): void {
  const pad = 2;
  box(page, f.x, f.y, f.width, f.height, { fill: style.fill, lineWidth: 0.5 });
  const label = style.upper ? f.label.toUpperCase() : f.label;
  drawTextAt(page, label, fonts.bold, style.labelSize, cm(f.x) + pad, cm(f.y) + pad);
  const content = fitText(fonts.regular, value, 7, cm(f.width) - 2 * pad);
  drawTextAt(page, content, fonts.regular, 7, cm(f.x) + pad, cm(f.y) + pad + style.labelSize + 2);
}
