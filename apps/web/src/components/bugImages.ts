export const MAX_BUG_IMAGES = 3;
export const BUG_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// Bytes after the resize; the server refuses more (apps/server/src/bugs/images.ts).
export const MAX_BUG_IMAGE_BYTES = 1024 * 1024;
const MAX_SIDE = 1920; // px, the longer side
const QUALITY = 0.8;

export interface PreparedImage {
  contentType: 'image/webp' | 'image/jpeg';
  // Base64, without the data: prefix.
  data: string;
  size: number;
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('image_too_large');
  }
}

function blobOf(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas_encode_failed'))),
      type,
      QUALITY,
    );
  });
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

// Drawing on a canvas and encoding again drops the EXIF data, such as the GPS position of a phone photo.
export async function prepareBugImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await blobOf(canvas, 'image/webp');
  // Safari has no WebP encoder and answers a PNG, often far over 1 MB: JPEG instead.
  if (blob.type !== 'image/webp') blob = await blobOf(canvas, 'image/jpeg');
  if (blob.size > MAX_BUG_IMAGE_BYTES) throw new ImageTooLargeError();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return { contentType, data: base64Of(bytes), size: blob.size };
}
