import { createHash } from 'node:crypto';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

// Synthetic passwords for the tests, not credentials.
const PASSWORD = 'uma-senha-boa-2026'; // gitleaks:allow
let t: TestApp;
let previous: Dispatcher;
let n = 0;
let ip = '';
let lines: string[] = [];

async function start(env: Record<string, string> = {}) {
  lines = [];
  t = await createTestApp({ env, logStream: { write: (line: string) => lines.push(line) } });
}

beforeEach(() => {
  previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const other = createHash('sha1').update('outra').digest('hex').toUpperCase();
  agent
    .get('https://api.pwnedpasswords.com')
    .intercept({ path: /^\/range\//, method: 'GET' })
    .reply(200, `${other.slice(5)}:1`)
    .persist();
  n += 1;
  ip = `198.18.4.${n}`;
});
afterEach(async () => {
  await t.close();
  setGlobalDispatcher(previous);
});

const post = (url: string, payload: object, headers: Record<string, string> = {}, from = ip) =>
  t.app.inject({
    method: 'POST',
    url,
    payload,
    remoteAddress: from,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  });
const lastCode = () => /\b(\d{6})\b/.exec(t.mail.at(-1)?.text ?? '')?.[1] ?? '';
const audit = (action: string) =>
  t.db.$client
    .prepare('SELECT result, detail FROM audit_log WHERE action = ? ORDER BY id')
    .all(action);

test('signup with an e-mail that has an account sends that person a login hint, not silence', async () => {
  await start();
  seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const response = await post('/api/auth/sign-up/email', {
    email: 'pessoa@example.com',
    password: PASSWORD,
    name: 'Outra Pessoa',
  });
  expect(response.statusCode).toBe(200);
  expect(t.mail.map((m) => m.subject)).toEqual(['Você já tem conta no NotaFlow']);
  expect(t.mail[0]?.text).toContain('/entrar');
});

test('a new user gets the welcome e-mail', async () => {
  await start();
  await post('/api/auth/email-otp/send-verification-otp', {
    email: 'nova@example.com',
    type: 'sign-in',
  });
  await post('/api/auth/sign-in/email-otp', { email: 'nova@example.com', otp: lastCode() });
  await expect.poll(() => t.mail.map((m) => m.subject)).toContain('Boas-vindas ao NotaFlow: sua primeira nota em 4 passos');
});

test('with signup closed, password signup answers the same for a known and an unknown e-mail', async () => {
  await start({ SIGNUP_OPEN: 'false' });
  seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const known = await post('/api/auth/sign-up/email', {
    email: 'pessoa@example.com',
    password: PASSWORD,
    name: 'X',
  });
  const unknown = await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: PASSWORD,
    name: 'X',
  });
  expect([known.statusCode, unknown.statusCode]).toEqual([403, 403]);
  expect((known.json() as { code: string }).code).toBe('signup_closed');
  expect((unknown.json() as { code: string }).code).toBe('signup_closed');
  expect(t.mail).toEqual([]);
});

test('parallel signups from one IP cannot pass the daily limit', async () => {
  await start({ SIGNUP_LIMIT_PER_IP_DAY: '1' });
  const emails = ['um@example.com', 'dois@example.com', 'tres@example.com'];
  const answers = await Promise.all(
    emails.map((email) =>
      post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'X' }),
    ),
  );
  expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(1);
  expect(t.db.$client.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
});

test('a refused signup is audited, and refusals do not count toward the limit', async () => {
  await start({ SIGNUP_OPEN: 'false' });
  await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: PASSWORD,
    name: 'X',
  });
  expect(audit('auth.signup')).toEqual([{ result: 'refused', detail: 'signup_closed' }]);
});

test('a failed password reset, a name change, and ending one session are audited', async () => {
  await start();
  seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const cookie = await t.cookieFor('pessoa@example.com');
  await post('/api/auth/email-otp/request-password-reset', { email: 'pessoa@example.com' });
  const wrong = lastCode() === '000000' ? '111111' : '000000';
  await post('/api/auth/email-otp/reset-password', {
    email: 'pessoa@example.com',
    otp: wrong,
    password: PASSWORD,
  });
  await post('/api/auth/update-user', { name: 'Novo Nome' }, { cookie });
  const token = (t.db.$client.prepare('SELECT token FROM auth_sessions').get() as { token: string })
    .token;
  await post('/api/auth/revoke-session', { token }, { cookie });
  expect(audit('auth.password_reset')).toEqual([{ result: 'refused', detail: null }]);
  expect(audit('auth.profile_updated')).toEqual([{ result: 'ok', detail: null }]);
  expect(audit('auth.session_revoked')).toEqual([{ result: 'ok', detail: null }]);
});

test('the request log never holds the query of an auth callback', async () => {
  await start();
  await t.app.inject({
    method: 'GET',
    url: '/api/auth/callback/google?code=SEGREDO-UNICO&state=abc',
    remoteAddress: ip,
  });
  const log = lines.join('\n');
  expect(log).toContain('/api/auth/callback/google');
  expect(log).not.toContain('SEGREDO-UNICO');
});

test('the request log never holds a DANFSe link token', async () => {
  await start();
  const token = 'Zx9_-'.repeat(8) + 'abc';
  for (const url of [`/n/${token}`, `/api/public/n/${token}`, `/api/public/n/${token}/pdf`]) {
    await t.app.inject({ method: 'GET', url, remoteAddress: ip });
  }
  const log = lines.join('\n');
  expect(log).toContain('/n/:token');
  expect(log).not.toContain(token);
});

test('the daily signup limit counts a whole IPv6 /64, so rotating addresses does not pass it', async () => {
  await start({ SIGNUP_LIMIT_PER_IP_DAY: '1' });
  const signup = (email: string, from: string) =>
    post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'X' }, {}, from);
  expect((await signup('um@example.com', '2001:db8:4:1::a')).statusCode).toBe(200);
  const again = await signup('dois@example.com', '2001:db8:4:1:ffff::b');
  expect((again.json() as { code: string }).code).toBe('signup_limit');
  expect((await signup('tres@example.com', '2001:db8:4:2::a')).statusCode).toBe(200);
});

test('update-user refuses an image and a name over 200 characters', async () => {
  await start();
  seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  const cookie = await t.cookieFor('pessoa@example.com');
  const image = await post('/api/auth/update-user', { image: 'https://evil.example/x.png' }, { cookie });
  expect((image.json() as { code: string }).code).toBe('image_not_supported');
  const long = await post('/api/auth/update-user', { name: 'x'.repeat(201) }, { cookie });
  expect((long.json() as { code: string }).code).toBe('name_too_long');
  expect((await post('/api/auth/update-user', { name: 'Nome Bom' }, { cookie })).statusCode).toBe(200);
});
