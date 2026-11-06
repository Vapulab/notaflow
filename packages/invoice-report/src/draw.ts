import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

export const INK = rgb(0x09 / 255, 0x0d / 255, 0x14 / 255);
export const NAVY = rgb(0x12 / 255, 0x17 / 255, 0x74 / 255);
export const BLUE = rgb(0x1e / 255, 0x40 / 255, 0xaf / 255);
export const MUTED = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
export const FAINT = rgb(0x94 / 255, 0xa3 / 255, 0xb8 / 255);
export const BORDER = rgb(0xe2 / 255, 0xe4 / 255, 0xe8 / 255);
export const RULE = rgb(0xee / 255, 0xf0 / 255, 0xf2 / 255);
export const RED = rgb(0xdc / 255, 0x26 / 255, 0x26 / 255);
export const HIGHLIGHT = rgb(0xf6 / 255, 0xf7 / 255, 0xfd / 255);
export const CHIP = rgb(0xee / 255, 0xf0 / 255, 0xfb / 255);
export const ZEBRA = rgb(0xfa / 255, 0xfa / 255, 0xf9 / 255);
export const WHITE = rgb(1, 1, 1);

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  display: PDFFont;
}

const assets = new Map<string, Uint8Array>();

function asset(name: string): Uint8Array {
  let bytes = assets.get(name);
  if (!bytes) {
    bytes = readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)));
    assets.set(name, bytes);
  }
  return bytes;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, bold, display] = await Promise.all([
    doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true }),
    doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true }),
    doc.embedFont(asset('SpaceGrotesk-Bold.ttf'), { subset: true }),
  ]);
  return { regular, bold, display };
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// 431065 -> "4.310,65"
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${groupThousands(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`;
}

export function formatMoney(cents: number): string {
  return `R$ ${formatCents(cents)}`;
}

export function formatCount(count: number): string {
  return groupThousands(String(count));
}

export function formatDocument(value: string | null): string {
  if (value === null || value === '') return '-';
  if (/^[0-9A-Z]{14}$/.test(value))
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  if (/^\d{11}$/.test(value)) return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  return value;
}

const advances = new WeakMap<PDFFont, Map<string, number>>();

// Sums cached advances per character: pdf-lib runs a full fontkit layout per call, which is too slow for 6,000 rows.
export function textWidth(font: PDFFont, text: string, size: number): number {
  let cache = advances.get(font);
  if (!cache) {
    cache = new Map();
    advances.set(font, cache);
  }
  let units = 0;
  for (const char of text) {
    let advance = cache.get(char);
    if (advance === undefined) {
      advance = font.widthOfTextAtSize(char, 1000);
      cache.set(char, advance);
    }
    units += advance;
  }
  return (units * size) / 1000;
}

export function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (textWidth(font, text, size) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 0 && textWidth(font, `${chars.join('')}…`, size) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

export type TextOptions = {
  font: PDFFont;
  size: number;
  color?: RGB;
  align?: 'left' | 'right' | 'center';
  // Cuts the text with an ellipsis to this width.
  width?: number;
};

// `baseline` is measured from the top of the page.
export function drawText(page: PDFPage, value: string, x: number, baseline: number, opts: TextOptions): void {
  const text = opts.width === undefined ? value : fitText(opts.font, value, opts.size, opts.width);
  let left = x;
  if (opts.align === 'right') left = x - textWidth(opts.font, text, opts.size);
  else if (opts.align === 'center') left = x - textWidth(opts.font, text, opts.size) / 2;
  page.drawText(text, { x: left, y: page.getHeight() - baseline, size: opts.size, font: opts.font, color: opts.color ?? INK });
}

function roundedPath(w: number, h: number, r: number): string {
  return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`;
}

export type BoxOptions = { radius?: number; fill?: RGB; border?: RGB; borderWidth?: number; dash?: number[] };

// `top` is measured from the top of the page.
export function drawBox(page: PDFPage, x: number, top: number, w: number, h: number, opts: BoxOptions): void {
  const radius = opts.radius ?? 0;
  const style = {
    ...(opts.fill ? { color: opts.fill } : {}),
    ...(opts.border ? { borderColor: opts.border, borderWidth: opts.borderWidth ?? 0.75 } : {}),
    ...(opts.dash ? { borderDashArray: opts.dash } : {}),
  };
  if (radius === 0) {
    page.drawRectangle({ x, y: page.getHeight() - top - h, width: w, height: h, ...style });
    return;
  }
  page.drawSvgPath(roundedPath(w, h, radius), { x, y: page.getHeight() - top, ...style });
}

export function drawLine(page: PDFPage, x1: number, x2: number, top: number, color: RGB, thickness: number): void {
  const y = page.getHeight() - top;
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

const LOGO_N = ['M8,12 H24 V88 H8 Z', 'M8,12 L25,12 L76,88 L59,88 Z'];
const LOGO_ARROW = 'M8,50 H102 V38 L120,56 L102,74 V62 H8 Z';
const LOGO_F = ['M60,12 H76 V88 H60 Z', 'M60,12 H116 V28 H60 Z', LOGO_ARROW];
const LOGO_RATIO = 128 / 100;

export function logoWidth(height: number): number {
  return height * LOGO_RATIO;
}

// The white stroke copies the SVG mask that cuts a gap in the N around the arrow.
export function drawLogo(page: PDFPage, x: number, top: number, height: number): void {
  const at = { x, y: page.getHeight() - top, scale: height / 100 };
  for (const path of LOGO_N) page.drawSvgPath(path, { ...at, color: INK });
  page.drawSvgPath(LOGO_ARROW, { ...at, color: WHITE, borderColor: WHITE, borderWidth: 6 });
  for (const path of LOGO_F) page.drawSvgPath(path, { ...at, color: NAVY });
}
