import { gunzipSync, gzipSync } from 'node:zlib';

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

// An NFS-e XML is a few dozen KB; the cap stops a gzip bomb from filling the memory.
export const MAX_XML_BYTES = 10 * 1024 * 1024;

export function gunzipBase64(payload: string): string {
  return gunzipSync(Buffer.from(payload, 'base64'), { maxOutputLength: MAX_XML_BYTES }).toString(
    'utf8',
  );
}
