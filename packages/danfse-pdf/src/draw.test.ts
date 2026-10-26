import { expect, test, vi } from 'vitest';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { box, cm, drawField } from './draw';

test('cm converts centimetres to points', () => {
  expect(cm(1)).toBeCloseTo(28.3465, 4);
  expect(cm(21)).toBeCloseTo(595.28, 1);
});
test('box flips the NT top-left cm to the pdf-lib bottom-left pt', () => {
  const drawRectangle = vi.fn();
  const page = { getHeight: () => 841.89, drawRectangle } as unknown as PDFPage;
  box(page, 0.3, 0.3, 20.4, 1.16, { lineWidth: 0.5 });
  const opts = drawRectangle.mock.calls[0]?.[0];
  expect(opts.x).toBeCloseTo(cm(0.3), 4);
  expect(opts.y).toBeCloseTo(841.89 - cm(0.3 + 1.16), 4);
  expect(opts.width).toBeCloseTo(cm(20.4), 4);
  expect(opts.height).toBeCloseTo(cm(1.16), 4);
  expect(opts.borderWidth).toBe(0.5);
  expect(opts.color).toBeUndefined();
});
test('box fill is gray 5%', () => {
  const drawRectangle = vi.fn();
  const page = { getHeight: () => 800, drawRectangle } as unknown as PDFPage;
  box(page, 0, 0, 1, 1, { fill: true, lineWidth: 1 });
  expect(drawRectangle.mock.calls[0]?.[0].color).toEqual({ type: 'Grayscale', gray: 0.95 });
});
test('field content keeps its descenders inside a 0.63 cm cell', () => {
  const drawText = vi.fn();
  const drawRectangle = vi.fn();
  const page = { getHeight: () => 841.89, drawText, drawRectangle } as unknown as PDFPage;
  const font = { widthOfTextAtSize: () => 10 } as unknown as PDFFont;
  drawField(page, { regular: font, bold: font }, { label: 'Optante', x: 1, y: 5, width: 5.09, height: 0.63 }, 'Exportação', { labelSize: 6, upper: false, fill: false });
  const cellBottom = 841.89 - cm(5 + 0.63);
  const label = drawText.mock.calls[0]?.[1];
  const content = drawText.mock.calls[1]?.[1];
  expect(label.y).toBeGreaterThan(content.y);
  expect(content.y - 1.5).toBeGreaterThan(cellBottom);
});
