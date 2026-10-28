import { expect, test } from 'vitest';
import { isApplePlatform } from './platform';

test.each([
  [{ platform: 'iPhone', userAgent: '' }, true],
  [{ platform: 'iPad', userAgent: '' }, true],
  [{ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }, true],
  [{ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }, true],
  [{ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, false],
  [{ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, false],
  [{}, false],
])('isApplePlatform(%j) is %s', (nav, expected) => {
  expect(isApplePlatform(nav)).toBe(expected);
});
