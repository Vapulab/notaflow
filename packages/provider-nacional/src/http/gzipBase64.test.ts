import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { gunzipBase64, gzipBase64, MAX_XML_BYTES } from './gzipBase64';

test('gunzipBase64 reads back what gzipBase64 wrote', () => {
  expect(gunzipBase64(gzipBase64('<NFSe/>'))).toBe('<NFSe/>');
});

test('gunzipBase64 refuses a payload that expands past the cap', () => {
  const bomb = gzipSync(Buffer.alloc(MAX_XML_BYTES + 1)).toString('base64');
  expect(() => gunzipBase64(bomb)).toThrow(RangeError);
});
