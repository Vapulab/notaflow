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
