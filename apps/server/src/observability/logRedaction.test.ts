import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../../test/testApp';

// Synthetic values; each must be absent from every log line.
const TOKEN = 'Zx9_-'.repeat(8) + 'abc';
const SECRETS = [
  TOKEN,
  'CODIGO-GOOGLE',
  'ESTADO-OAUTH',
  'ASSINATURA-HMAC',
  'ana@example.com',
  'ana%40example.com',
  '11144477735',
  '111.444.777-35',
  '12345678000100',
  'hunter2',
];

let t: TestApp;
const lines: string[] = [];

beforeAll(async () => {
  t = await createTestApp({ logStream: { write: (line: string) => lines.push(line) } });
  const from = { remoteAddress: '198.18.9.1' };
  for (const url of [
    `/n/${TOKEN}`,
    `/api/public/n/${TOKEN}`,
    `/api/public/n/${TOKEN}/pdf`,
    '/nota/descadastrar?a=ana%40example.com&t=ASSINATURA-HMAC',
    '/lembretes/descadastrar?u=user-1&t=ASSINATURA-HMAC',
    '/api/auth/callback/google?code=CODIGO-GOOGLE&state=ESTADO-OAUTH',
    '/api/public/cnpj-regime/12345678000100',
    `/api/nada/ana@example.com?token=${TOKEN}&cpf=11144477735`,
    `/sem-rota/n/${TOKEN}?q=111.444.777-35`,
  ]) {
    await t.app.inject({ method: 'GET', url, ...from });
  }
  // The shapes the code base logs: a line, an object with a message, an error, and a format argument.
  t.app.log.info('e-mail to ana@example.com: Seu código\nCPF 111.444.777-35');
  t.app.log.warn({ module: 'mail', to: 'ana@example.com', password: 'hunter2' }, 'send failed');
  t.app.log.error(new Error('Sefin refused CNPJ 12345678000100 for ana@example.com'));
  t.app.log.error({ err: new Error(`GET /n/${TOKEN} broke`) }, 'unhandled error');
  t.app.log.info('lookup %s', 'CPF 11144477735');
});
afterAll(() => t.close());

test('no log line holds a link token, an auth code, a signature, an e-mail, a CPF, a CNPJ, or a password', () => {
  expect(lines.length).toBeGreaterThan(10);
  const log = lines.join('\n');
  for (const secret of SECRETS) expect(log, secret).not.toContain(secret);
});

test('the log keeps the operational fields', () => {
  const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const urls = entries.flatMap((entry) => {
    const req = entry.req as { url?: string } | undefined;
    return req?.url ? [req.url] : [];
  });
  expect(urls).toEqual(
    expect.arrayContaining([
      '/n/:token',
      '/api/public/n/:token/pdf',
      '/nota/descadastrar',
      '/lembretes/descadastrar',
      '/api/auth/callback/google',
      '/api/public/cnpj-regime/:cnpj',
    ]),
  );
  const done = entries.find((entry) => entry.msg === 'request completed');
  expect(done).toMatchObject({ reqId: expect.any(String), module: expect.any(String) });
  expect(done?.res).toMatchObject({ statusCode: expect.any(Number) });
  expect(done?.responseTime).toEqual(expect.any(Number));
  const failed = entries.find((entry) => entry.msg === 'send failed');
  expect(failed).toMatchObject({ module: 'mail', to: '***@example.com', password: '***' });
  const error = entries.find((entry) => String(entry.msg).startsWith('Sefin refused'));
  expect(error?.msg).toBe('Sefin refused CNPJ *** for ***@example.com');
  expect(error?.err).toMatchObject({
    type: 'Error',
    message: 'Sefin refused CNPJ *** for ***@example.com',
  });
});
