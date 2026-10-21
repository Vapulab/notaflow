import { MockAgent } from 'undici';
import { expect, test } from 'vitest';
import { r2Client, signRequest } from './r2';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('the signature matches the GET Object example of the AWS SigV4 documentation', () => {
  const headers = signRequest({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    headers: { Range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA,
    region: 'us-east-1',
    service: 's3',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  expect(headers.authorization).toBe(
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
  expect(headers['x-amz-date']).toBe('20130524T000000Z');
});

const SETTINGS = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'r2-key-id',
  secretAccessKey: 'r2-secret',
  bucket: 'bugs',
};
const ORIGIN = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';

function setup() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const seen: Record<string, string>[] = [];
  const pool = agent.get(ORIGIN);
  const capture = (headers: unknown) => {
    seen.push(headers as Record<string, string>);
  };
  return { agent, pool, seen, capture, client: r2Client(SETTINGS, agent) };
}

const signed = (headers: Record<string, string> | undefined) => {
  expect(headers?.authorization).toMatch(
    /^AWS4-HMAC-SHA256 Credential=r2-key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
  );
  expect(headers?.['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  expect(headers?.['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
};

test('PUT sends the bytes to the bucket path, signed with the payload hash and the content type', async () => {
  const s = setup();
  let body = '';
  s.pool.intercept({ path: '/bugs/bug-reports/r1/1.webp', method: 'PUT' }).reply((request) => {
    s.capture(request.headers);
    body = String(request.body);
    return { statusCode: 200, data: '' };
  });
  await s.client.put('bug-reports/r1/1.webp', Buffer.from('RIFF'), 'image/webp');
  expect(body).toBe('RIFF');
  signed(s.seen[0]);
  expect(s.seen[0]?.authorization).toContain(
    'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
  );
  expect(s.seen[0]?.['x-amz-content-sha256']).not.toBe(EMPTY_SHA);
});

test('PUT throws on a refused answer, with the reason but no secret', async () => {
  const s = setup();
  s.pool
    .intercept({ path: '/bugs/k.png', method: 'PUT' })
    .reply(403, '<Error><Code>AccessDenied</Code></Error>');
  await expect(s.client.put('k.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
    /R2 PUT answered 403: .*AccessDenied/,
  );
});

test('GET streams the object, and a missing object is null', async () => {
  const s = setup();
  s.pool.intercept({ path: '/bugs/k.png', method: 'GET' }).reply((request) => {
    s.capture(request.headers);
    return {
      statusCode: 200,
      data: 'PNGDATA',
      responseOptions: { headers: { 'content-length': '7' } },
    };
  });
  s.pool.intercept({ path: '/bugs/gone.png', method: 'GET' }).reply(404, '<Error/>');
  const object = await s.client.get('k.png');
  expect(object?.size).toBe(7);
  const chunks: Buffer[] = [];
  for await (const chunk of object?.body ?? []) chunks.push(Buffer.from(chunk as Buffer));
  expect(Buffer.concat(chunks).toString()).toBe('PNGDATA');
  signed(s.seen[0]);
  expect(s.seen[0]?.['x-amz-content-sha256']).toBe(EMPTY_SHA);
  expect(await s.client.get('gone.png')).toBeNull();
});

test('DELETE counts a missing object as deleted, and throws on a server error', async () => {
  const s = setup();
  s.pool.intercept({ path: '/bugs/a.webp', method: 'DELETE' }).reply((request) => {
    s.capture(request.headers);
    return { statusCode: 204, data: '' };
  });
  s.pool.intercept({ path: '/bugs/b.webp', method: 'DELETE' }).reply(404, '');
  s.pool.intercept({ path: '/bugs/c.webp', method: 'DELETE' }).reply(500, 'oops');
  await s.client.delete('a.webp');
  signed(s.seen[0]);
  await s.client.delete('b.webp');
  await expect(s.client.delete('c.webp')).rejects.toThrow(/R2 DELETE answered 500/);
});
