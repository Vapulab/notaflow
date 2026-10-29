import { MockAgent } from 'undici';
import { expect, test } from 'vitest';
import { resendUnsuppress } from './resendSuppressions';

function agentAnswering(status: number) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const seen: { path: string; authorization: string | undefined }[] = [];
  agent
    .get('https://api.resend.com')
    .intercept({ path: /^\/suppressions\//, method: 'DELETE' })
    .reply(status, (options) => {
      const headers = options.headers as Record<string, string>;
      seen.push({ path: options.path, authorization: headers.authorization });
      return {};
    });
  return { agent, seen };
}

test('DELETE goes to the encoded address with the key', async () => {
  const { agent, seen } = agentAnswering(200);
  await resendUnsuppress({ apiKey: 're_key', dispatcher: agent })('cliente+nf@example.com');
  expect(seen).toEqual([
    { path: '/suppressions/cliente%2Bnf%40example.com', authorization: 'Bearer re_key' },
  ]);
});

test('404 resolves', async () => {
  const { agent } = agentAnswering(404);
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: agent })('cliente@example.com'),
  ).resolves.toBeUndefined();
});

test('500 rejects', async () => {
  const { agent } = agentAnswering(500);
  await expect(
    resendUnsuppress({ apiKey: 'k', dispatcher: agent })('cliente@example.com'),
  ).rejects.toThrow('Resend answered 500');
});
