import type { PDFFont } from 'pdf-lib';
import { expect, test } from 'vitest';
import { cm } from './draw';
import { fitLines, linesFitting } from './blocks';

const font = { widthOfTextAtSize: (text: string) => text.length * 3 } as unknown as PDFFont;

test('fitLines keeps the lines that fit and ends the last one with "..."', () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const lines = fitLines(font, text, 7, 60, 3);
  expect(lines).toHaveLength(3);
  expect(lines[2]?.endsWith('...')).toBe(true);
  for (const line of lines) expect(line.length * 3).toBeLessThanOrEqual(60);
});
test('fitLines adds nothing when the text fits', () => {
  expect(fitLines(font, 'one two three', 7, 300, 3)).toEqual(['one two three']);
});
test('linesFitting survives the cm round trip and keeps the last line inside the box', () => {
  for (let lines = 1; lines <= 40; lines += 1) {
    const heightPt = cm((lines * 8.5 + 4) / cm(1)) - 4;
    expect(linesFitting(heightPt)).toBe(lines);
    // The last baseline is 7 pt under its line top and the descender takes 1.5 pt more.
    expect((linesFitting(heightPt) - 1) * 8.5 + 7 + 1.5).toBeLessThanOrEqual(heightPt + 1e-6);
  }
  expect(linesFitting(20)).toBe(2);
});
