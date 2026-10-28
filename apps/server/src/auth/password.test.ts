import { createHash } from 'node:crypto';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

// Synthetic passwords for the tests, not credentials.
const LEAKED = 'senha-vazada-123'; // gitleaks:allow
const GOOD = 'uma-senha-boa-2026'; // gitleaks:allow
const NEW = 'nova-senha-forte-2026'; // gitleaks:allow
const SHORT = 'curta1234'; // gitleaks:allow
let t: TestApp;
let previous: Dispatcher;
let agent: MockAgent;
// Better Auth keeps rate-limit counters per process, so each test speaks from its own IP.
let n = 0;
let ip = '';

beforeEach(async () => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const hash = createHash('sha1').update(LEAKED).digest('hex').toUpperCase();
  agent
    .get('https://api.pwnedpasswords.com')
    .intercept({ path: /^\/range\//, method: 'GET' })
    .reply(200, `${hash.slice(5)}:42\r\n0000000000000000000000000000000000A:1`)
    .persist();
  n += 1;
  ip = `198.18.0.${n}`;
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
  setGlobalDispatcher(previous);
});

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url,
    payload,
    remoteAddress: ip,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  });
// The latest e-mail with a code: the welcome e-mail can arrive after it.
const lastCode = () =>
  t.mail
    .map((m) => /\b(\d{6})\b/.exec(m.text)?.[1])
    .filter((code) => code !== undefined)
    .at(-1) ?? '';
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  [response.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ');

test('a password shorter than 10 characters is refused', async () => {
  const response = await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: SHORT,
    name: 'Nova',
  });
  expect(response.statusCode).toBe(400);
});

test('a password found in leaks is refused with a Portuguese message', async () => {
  const response = await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: LEAKED,
    name: 'Nova',
  });
  expect(response.statusCode).toBe(400);
  expect((response.json() as { message: string }).message).toBe(
    'Esta senha apareceu em vazamentos conhecidos. Escolha outra.',
  );
});

test('signup with a password sends a code, and only the code opens the session', async () => {
  const signup = await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: GOOD,
    name: 'Nova',
  });
  expect(signup.statusCode).toBe(200);
  expect(cookieOf(signup)).not.toContain('session_token');
  expect(t.mail.map((m) => m.subject)).toContain('Confirme seu e-mail no NotaFlow');

  const early = await post('/api/auth/sign-in/email', {
    email: 'nova@example.com',
    password: GOOD,
  });
  expect(early.statusCode).toBe(403);

  const verified = await post('/api/auth/email-otp/verify-email', {
    email: 'nova@example.com',
    otp: lastCode(),
  });
  expect(verified.statusCode).toBe(200);
  expect(cookieOf(verified)).toContain('notaflow.session_token=');

  const login = await post('/api/auth/sign-in/email', {
    email: 'nova@example.com',
    password: GOOD,
  });
  expect(login.statusCode).toBe(200);
});

test('a password signup gets the welcome e-mail only after the code confirms the address, and once', async () => {
  const welcome = () =>
    t.mail.filter((m) => m.subject.startsWith('Boas-vindas ao NotaFlow')).length;
  await post('/api/auth/sign-up/email', { email: 'nova@example.com', password: GOOD, name: 'Nova' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(welcome()).toBe(0);

  await post('/api/auth/email-otp/verify-email', { email: 'nova@example.com', otp: lastCode() });
  await expect.poll(welcome).toBe(1);

  await post('/api/auth/sign-in/email', { email: 'nova@example.com', password: GOOD });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(welcome()).toBe(1);
});

test('a user who never had a password creates one by reset code, and old sessions end', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const old = await t.as('pessoa@example.com');
  const ask = await post('/api/auth/email-otp/request-password-reset', {
    email: 'pessoa@example.com',
  });
  expect(ask.statusCode).toBe(200);
  expect(t.mail.at(-1)?.subject).toBe('Código para redefinir sua senha');
  const reset = await post('/api/auth/email-otp/reset-password', {
    email: 'pessoa@example.com',
    otp: lastCode(),
    password: NEW,
  });
  expect(reset.statusCode).toBe(200);
  const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: old });
  expect(me.statusCode).toBe(401);
  const login = await post('/api/auth/sign-in/email', {
    email: 'pessoa@example.com',
    password: NEW,
  });
  expect(login.statusCode).toBe(200);
});
