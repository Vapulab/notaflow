import { expect, test } from 'vitest';
import { markFor } from './markFor';

test('markFor', () => {
  expect(markFor('issued', [])).toBe('none');
  expect(markFor('cancelled', ['101101'])).toBe('cancelada');
  expect(markFor('cancelled', ['105102'])).toBe('substituida');
});
test('only a cancelled invoice carries a mark', () => {
  expect(markFor('issued', ['105102'])).toBe('none');
  expect(markFor('cancelled', [])).toBe('cancelada');
});
