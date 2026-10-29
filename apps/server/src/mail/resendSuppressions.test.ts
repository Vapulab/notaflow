import { MockAgent } from 'undici';
import { expect, test } from 'vitest';
import { resendUnsuppress, unsuppressFailure } from './resendSuppressions';

// Resend answers the GET with `getStatus` and the given origin, and the DELETE with `deleteStatus`.
function resend(getStatus: number, origin: string | null, deleteStatus = 200) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const seen: { method: string; path: string; authorization: string | undefined }[] = [];
  const pool = agent.get('https://api.resend.com');
  const record = (method: string) => (options: { path: string; headers?: unknown }) => {
    const headers = options.headers as Record<string, string>;
    seen.push({ method, path: options.path, authorization: headers.authorization });
    return {};
  };
  pool.intercept({ path: /^\/suppressions\//, method: 'GET' }).reply(getStatus, (options) => {
    record('GET')(options);
    return origin ? { object: 'suppression', origin } : { name: 'not_found' };
  });
  pool
    .intercept({ path: /^\/suppressions\//, method: 'DELETE' })
    .reply(deleteStatus, record('DELETE'));
  return { agent, seen };
}

test('a bounce on Resend is looked up, then deleted at the encoded address with the key', async () => {
  const { agent, seen } = resend(200, 'bounce');
  await expect(
    resendUnsuppress({ apiKey: 're_key', dispatcher: agent })('cliente+nf@example.com'),
  ).resolves.toBe('removed');
  expect(seen).toEqual([
    {
      method: 'GET',
      path: '/suppressions/cliente%2Bnf%40example.com',
      authorization: 'Bearer re_key',
    },
    {
      method: 'DELETE',
      path: '/suppressions/cliente%2Bnf%40example.com',
      authorization: 'Bearer re_key',
    },
  ]);
});

test('a complaint on Resend is never deleted', async () => {
  const { agent, seen } = resend(200, 'complaint');
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: agent })('cliente@example.com'),
  ).resolves.toBe('complaint');
  expect(seen.map((r) => r.method)).toEqual(['GET']);
});

test('an address Resend does not hold needs no delete', async () => {
  const { agent, seen } = resend(404, null);
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: agent })('cliente@example.com'),
  ).resolves.toBe('removed');
  expect(seen.map((r) => r.method)).toEqual(['GET']);
});

test('a failed lookup or delete rejects with the status only', async () => {
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: resend(500, null).agent })('cliente@example.com'),
  ).rejects.toThrow('Resend answered 500');
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: resend(200, 'bounce', 403).agent })(
      'cliente@example.com',
    ),
  ).rejects.toThrow('Resend answered 403');
  // A DELETE that finds nothing left is the state we want.
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: resend(200, 'manual', 404).agent })(
      'cliente@example.com',
    ),
  ).resolves.toBe('removed');
});

test('unsuppressFailure keeps only the status message or the error class', () => {
  expect(unsuppressFailure(new Error('Resend answered 403'))).toBe('Resend answered 403');
  expect(unsuppressFailure(new TypeError('fetch failed /suppressions/a%40b.com'))).toBe(
    'TypeError',
  );
  expect(unsuppressFailure('a@b.com')).toBe('string');
});
