import { createHash } from 'node:crypto';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

// A synthetic password for the tests, not a credential.
const PASSWORD = 'uma-senha-boa-2026'; // gitleaks:allow
let t: TestApp;
let previous: Dispatcher;
let n = 0;
let ip = '';
let userId = '';

beforeEach(async () => {
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
  ip = `198.18.3.${n}`;
  t = await createTestApp();
  userId = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' }).userId;
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
const lastCode = () => /\b(\d{6})\b/.exec(t.mail.at(-1)?.text ?? '')?.[1] ?? '';
type Row = { action: string; result: string; detail: string | null; entity: string; ip: string };
const audit = () =>
  t.db.$client
    .prepare("SELECT action, result, detail, entity, ip FROM audit_log WHERE action LIKE 'auth.%'")
    .all() as Row[];

test('a code login records the code sent and the login, with the IP and never the code', async () => {
  await post('/api/auth/email-otp/send-verification-otp', {
    email: 'pessoa@example.com',
    type: 'sign-in',
  });
  const code = lastCode();
  await post('/api/auth/sign-in/email-otp', { email: 'pessoa@example.com', otp: code });
  expect(audit()).toEqual([
    { action: 'auth.code_sent', result: 'ok', detail: 'sign-in', entity: userId, ip },
    { action: 'auth.login', result: 'ok', detail: 'email-otp', entity: userId, ip },
  ]);
  expect(JSON.stringify(audit())).not.toContain(code);
});

test('a code sent to an unknown e-mail names only its domain', async () => {
  await post('/api/auth/email-otp/send-verification-otp', {
    email: 'alguem@desconhecido.example',
    type: 'sign-in',
  });
  expect(audit()).toEqual([
    {
      action: 'auth.code_sent',
      result: 'ok',
      detail: 'sign-in',
      entity: '@desconhecido.example',
      ip,
    },
  ]);
});

test('a wrong code records a failed login', async () => {
  await post('/api/auth/email-otp/send-verification-otp', {
    email: 'pessoa@example.com',
    type: 'sign-in',
  });
  const wrong = lastCode() === '000000' ? '111111' : '000000';
  await post('/api/auth/sign-in/email-otp', { email: 'pessoa@example.com', otp: wrong });
  expect(audit().at(-1)).toMatchObject({
    action: 'auth.login_failed',
    result: 'refused',
    detail: 'email-otp',
    entity: userId,
  });
});

test('password reset, password login, logout, and ending every session are recorded', async () => {
  await post('/api/auth/email-otp/request-password-reset', { email: 'pessoa@example.com' });
  await post('/api/auth/email-otp/reset-password', {
    email: 'pessoa@example.com',
    otp: lastCode(),
    password: PASSWORD,
  });
  const login = await post('/api/auth/sign-in/email', {
    email: 'pessoa@example.com',
    password: PASSWORD,
  });
  const cookie = [login.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ');
  await post('/api/auth/sign-out', {}, { cookie });
  await post('/api/auth/revoke-sessions', {}, { cookie: await t.cookieFor('pessoa@example.com') });
  expect(audit().map((r) => [r.action, r.result, r.detail])).toEqual([
    ['auth.code_sent', 'ok', 'forget-password'],
    ['auth.password_reset', 'ok', null],
    ['auth.login', 'ok', 'password'],
    ['auth.logout', 'ok', null],
    ['auth.sessions_revoked', 'ok', null],
  ]);
});

test('removing a passkey is recorded', async () => {
  t.db.$client
    .prepare(
      `INSERT INTO auth_passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ('pk1', 'Notebook', 'key', ?, 'cred', 0, 'singleDevice', 0)`,
    )
    .run(userId);
  const response = await post(
    '/api/auth/passkey/delete-passkey',
    { id: 'pk1' },
    { cookie: await t.cookieFor('pessoa@example.com') },
  );
  expect(response.statusCode).toBe(200);
  expect(audit().at(-1)).toMatchObject({
    action: 'auth.passkey_removed',
    result: 'ok',
    entity: userId,
  });
});

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  [response.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ');
const codeLogin = async (email: string) => {
  await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  return post('/api/auth/sign-in/email-otp', { email, otp: lastCode() });
};
const me = async (cookie: string) =>
  (await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json() as {
    passwordRemoved: boolean;
  };

test('a code login that erases the password of an unconfirmed signup is recorded and warned once', async () => {
  await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: PASSWORD,
    name: 'Nova Pessoa',
  });
  const cookie = cookieOf(await codeLogin('nova@example.com'));
  const removed = t.db.$client
    .prepare('SELECT password_removed_at FROM users WHERE email = ?')
    .get('nova@example.com') as { password_removed_at: number | null };
  expect(removed.password_removed_at).toEqual(expect.any(Number));
  expect(audit().map((r) => r.action)).toContain('auth.password_removed');
  expect((await me(cookie)).passwordRemoved).toBe(true);

  const dismissed = await t.app.inject({
    method: 'POST',
    url: '/api/me/password-notice',
    headers: { cookie, origin: ORIGIN },
    payload: {},
  });
  expect(dismissed.statusCode).toBe(204);
  expect((await me(cookie)).passwordRemoved).toBe(false);
  expect(audit().map((r) => r.action)).toContain('auth.password_notice_seen');
});

test('a new password clears the warning', async () => {
  await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: PASSWORD,
    name: 'Nova Pessoa',
  });
  await codeLogin('nova@example.com');
  await post('/api/auth/email-otp/request-password-reset', { email: 'nova@example.com' });
  await post('/api/auth/email-otp/reset-password', {
    email: 'nova@example.com',
    otp: lastCode(),
    password: 'outra-senha-boa-2026', // gitleaks:allow
  });
  const row = t.db.$client
    .prepare('SELECT password_removed_at FROM users WHERE email = ?')
    .get('nova@example.com') as { password_removed_at: number | null };
  expect(row.password_removed_at).toBeNull();
});

test('a code login of a confirmed user with a password erases nothing', async () => {
  await post('/api/auth/email-otp/request-password-reset', { email: 'pessoa@example.com' });
  await post('/api/auth/email-otp/reset-password', {
    email: 'pessoa@example.com',
    otp: lastCode(),
    password: PASSWORD,
  });
  const cookie = cookieOf(await codeLogin('pessoa@example.com'));
  expect(audit().map((r) => r.action)).not.toContain('auth.password_removed');
  expect((await me(cookie)).passwordRemoved).toBe(false);
});
