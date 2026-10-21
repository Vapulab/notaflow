import { expect, test } from 'vitest';
import { decodeImages, imageKey, MAX_IMAGE_BYTES } from './images';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

const b64 = (data: Buffer) => data.toString('base64');

test('each type passes with its own first bytes', () => {
  const images = decodeImages([
    { contentType: 'image/png', data: b64(PNG) },
    { contentType: 'image/jpeg', data: b64(JPEG) },
    { contentType: 'image/webp', data: b64(WEBP) },
  ]);
  expect(images.map((image) => [image.contentType, image.data.length])).toEqual([
    ['image/png', PNG.length],
    ['image/jpeg', JPEG.length],
    ['image/webp', WEBP.length],
  ]);
});

test.each([
  ['a PNG declared as WebP', [{ contentType: 'image/webp' as const, data: b64(PNG) }]],
  [
    'an HTML file declared as PNG',
    [{ contentType: 'image/png' as const, data: b64(Buffer.from('<html>')) }],
  ],
  ['an empty image', [{ contentType: 'image/jpeg' as const, data: '' }]],
  [
    'an image over 1 MB',
    [
      {
        contentType: 'image/jpeg' as const,
        data: b64(Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)])),
      },
    ],
  ],
  [
    'four images',
    Array.from({ length: 4 }, () => ({ contentType: 'image/png' as const, data: b64(PNG) })),
  ],
])('%s is refused', (_name, input) => {
  expect(() => decodeImages(input)).toThrow(expect.objectContaining({ code: 'invalid_bug_image' }));
});

test('the key names the report, the position, and the extension', () => {
  expect(imageKey('r1', 2, 'image/jpeg')).toBe('bug-reports/r1/2.jpg');
  expect(imageKey('r1', 1, 'image/webp')).toBe('bug-reports/r1/1.webp');
});
