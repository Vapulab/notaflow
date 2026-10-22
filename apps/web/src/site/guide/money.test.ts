import { expect, test } from 'vitest';
import { parseMoney } from './money';

test.each([
  ['12.345,67', 1_234_567],
  ['R$ 1.000', 100_000],
  ['R$1.234,56', 123_456],
  ['1234,56', 123_456],
  ['1234', 123_400],
  ['1,5', 150],
  ['  10.000,00  ', 1_000_000],
])('parseMoney(%s) is %i cents', (text, cents) => {
  expect(parseMoney(text)).toBe(cents);
});

test.each(['', '   ', 'abc', '1,234', '-10', '12,345,67', 'R$'])(
  'parseMoney(%s) is null',
  (text) => {
    expect(parseMoney(text)).toBeNull();
  },
);
