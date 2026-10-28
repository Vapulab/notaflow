import { expect, test } from 'vitest';
import { placePanel } from './sharePlacement';

const viewport = { width: 1000, height: 800 };
const panel = { width: 224, height: 160 };
const at = (left: number, top: number) => ({
  left,
  top,
  right: left + 80,
  bottom: top + 32,
});

test('opens below the trigger, left edges aligned', () => {
  expect(placePanel({ trigger: at(100, 100), panel, viewport })).toEqual({
    top: 136,
    left: 100,
    placement: 'below',
  });
});

test('flips above when the room below is too small and the room above is larger', () => {
  expect(placePanel({ trigger: at(100, 700), panel, viewport })).toEqual({
    top: 700 - 4 - 160,
    left: 100,
    placement: 'above',
  });
});

test('stays below when neither side fits but below is larger', () => {
  const small = { width: 1000, height: 220 };
  expect(placePanel({ trigger: at(100, 20), panel, viewport: small }).placement).toBe('below');
});

test('aligns to the right edge of the trigger near the right edge of the screen', () => {
  expect(placePanel({ trigger: at(900, 100), panel, viewport }).left).toBe(980 - 224);
});

test('never leaves the screen on the left', () => {
  expect(placePanel({ trigger: at(-50, 100), panel, viewport }).left).toBe(8);
});
