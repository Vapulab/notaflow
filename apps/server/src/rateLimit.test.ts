import { expect, test } from 'vitest';
import { createRateLimiter } from './rateLimit';

test('it allows max hits in the window, then refuses until the window passes', () => {
  const allow = createRateLimiter({ windowMs: 1000, max: 2 });
  expect([allow('a', 0), allow('a', 1), allow('a', 2)]).toEqual([true, true, false]);
  expect(allow('b', 2)).toBe(true);
  expect(allow('a', 1001)).toBe(true);
});

test('a key idle for a whole window is dropped by the sweep', () => {
  const allow = createRateLimiter({ windowMs: 1000, max: 2, sweepEvery: 3 });
  allow('idle', 0);
  expect(allow.size()).toBe(1);
  allow('b', 1500);
  allow('b', 1501);
  expect(allow.size()).toBe(1);
  expect(allow('idle', 1502)).toBe(true);
});
