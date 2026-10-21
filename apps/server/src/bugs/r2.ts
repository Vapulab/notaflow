import { createHash, createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';
import { type Dispatcher, request } from 'undici';
import type { R2Settings } from '../config';

const TIMEOUT_MS = 15_000;
const REGION = 'auto';
const SERVICE = 's3';

// The three S3 calls the screenshots need; each throws on a failed answer.
export interface R2Client {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  // null when the object does not exist.
  get(key: string): Promise<{ body: Readable; size: number | null } | null>;
  // A missing object counts as deleted, so a purge run can repeat.
  delete(key: string): Promise<void>;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

// RFC 3986 per segment, as SigV4 wants: encodeURIComponent leaves !'()* alone.
function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export interface SignInput {
  method: string;
  host: string;
  // Already encoded, without a query string.
  path: string;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

// AWS Signature Version 4 with node:crypto, so the S3 API of R2 needs no SDK and no dependency.
export function signRequest(input: SignInput): Record<string, string> {
  const amzDate = input.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v])),
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = [
    input.method,
    input.path,
    '',
    ...names.map((name) => `${name}:${(headers[name] ?? '').trim()}`),
    '',
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function r2Client(settings: R2Settings, dispatcher?: Dispatcher): R2Client {
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;

  async function send(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer, type?: string) {
    const path = encodePath(`/${settings.bucket}/${key}`);
    const signed = signRequest({
      method,
      host,
      path,
      headers: type ? { 'content-type': type } : {},
      payloadHash: sha256(body ?? ''),
      region: REGION,
      service: SERVICE,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      now: new Date(),
    });
    // undici writes the Host header from the URL; the signed value is the same.
    const headers = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== 'host'));
    return request(`https://${host}${path}`, {
      method,
      headers,
      ...(body ? { body } : {}),
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
      ...(dispatcher ? { dispatcher } : {}),
    });
  }

  async function fail(response: Dispatcher.ResponseData, action: string): Promise<never> {
    // The S3 error XML names the cause (a wrong key, a missing bucket), never our secret.
    const detail = (await response.body.text()).slice(0, 300);
    throw new Error(`R2 ${action} answered ${response.statusCode}: ${detail}`);
  }

  return {
    async put(key, body, contentType) {
      const response = await send('PUT', key, body, contentType);
      if (response.statusCode >= 300) await fail(response, 'PUT');
      await response.body.dump();
    },
    async get(key) {
      const response = await send('GET', key);
      if (response.statusCode === 404) {
        await response.body.dump();
        return null;
      }
      if (response.statusCode >= 300) await fail(response, 'GET');
      const length = Number(response.headers['content-length']);
      return { body: response.body, size: Number.isInteger(length) ? length : null };
    },
    async delete(key) {
      const response = await send('DELETE', key);
      if (response.statusCode >= 300 && response.statusCode !== 404) {
        await fail(response, 'DELETE');
      }
      await response.body.dump();
    },
  };
}
