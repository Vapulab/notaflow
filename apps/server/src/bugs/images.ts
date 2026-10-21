import { HttpError } from '../httpError';

export const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGES = 3;
// Bytes after base64 decoding; the browser resizes and re-encodes to stay under it.
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export interface BugImage {
  contentType: ImageType;
  data: Buffer;
}

const EXTENSION: Record<ImageType, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export const imageKey = (reportId: string, position: number, type: ImageType) =>
  `bug-reports/${reportId}/${position}.${EXTENSION[type]}`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The first bytes decide, not the declared type: a page renders what the admin opens.
function matches(type: ImageType, data: Buffer): boolean {
  switch (type) {
    case 'image/png':
      return data.subarray(0, 8).equals(PNG);
    case 'image/jpeg':
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/webp':
      return (
        data.subarray(0, 4).toString('latin1') === 'RIFF' &&
        data.subarray(8, 12).toString('latin1') === 'WEBP'
      );
  }
}

// The route schema already checked the count, the type, the base64 alphabet, and the length.
export function decodeImages(input: { contentType: ImageType; data: string }[]): BugImage[] {
  if (input.length > MAX_IMAGES) throw new HttpError(400, 'invalid_bug_image');
  return input.map(({ contentType, data }) => {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !matches(contentType, bytes)) {
      throw new HttpError(400, 'invalid_bug_image');
    }
    return { contentType, data: bytes };
  });
}
