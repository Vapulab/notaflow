import { expect, test } from 'vitest';
import { BLOCKS, FIELDS } from './layout';

test('blocks follow the NT 008 order', () => {
  expect(BLOCKS.map((b) => b.key)).toEqual(['header', 'identification', 'provider', 'customer',
    'recipient', 'intermediary', 'service', 'issqn', 'federal', 'ibsCbs', 'total', 'complementary']);
});
test('every field fits the A4 page inside the margins', () => {
  for (const f of FIELDS) {
    expect(f.x).toBeGreaterThanOrEqual(0.15);
    expect(f.x + f.width).toBeLessThanOrEqual(21.0 - 0.15);
    expect(f.y + f.height).toBeLessThanOrEqual(29.7 - 0.15);
  }
});
test('keys are unique', () => expect(new Set(FIELDS.map((f) => f.key)).size).toBe(FIELDS.length));
test('the identification block matches NT 008 item 2.4.5', () => {
  expect(FIELDS.find((f) => f.key === 'accessKey')).toMatchObject({ x: 0.3, y: 1.48, width: 15.3, height: 0.77, maxChars: 50 });
  expect(FIELDS.find((f) => f.key === 'nfseNumber')).toMatchObject({ x: 0.3, y: 2.27, width: 5.09, maxChars: 13 });
});
