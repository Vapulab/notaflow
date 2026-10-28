import { createHash } from 'node:crypto';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';
import { parseSignupSource, SIGNUP_SOURCE_HEADER } from './signupSource';

// Synthetic password for the tests, not a credential.
const PASSWORD = 'uma-senha-boa-2026'; // gitleaks:allow
let t: TestApp;
let previous: Dispatcher;
let n = 0;
let ip = '';

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
  ip = `198.18.6.${n}`;
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
const lastCode = () =>
  t.mail
    .map((m) => /\b(\d{6})\b/.exec(m.text)?.[1])
    .filter((code) => code !== undefined)
    .at(-1) ?? '';
const sourceOf = (email: string) =>
  t.db.$client
    .prepare(
      'SELECT signup_source AS source, signup_medium AS medium, signup_campaign AS campaign FROM users WHERE email = ?',
    )
    .get(email);

test.each([
  ['utm_source=instagram&utm_medium=bio', { source: 'instagram', medium: 'bio', campaign: null }],
  [
    'utm_source=WhatsApp&utm_campaign=grupo-sp_1',
    { source: 'whatsapp', medium: null, campaign: 'grupo-sp_1' },
  ],
  ['utm_medium=bio', null],
  ['', null],
  [null, null],
  [42, null],
  ['utm_source=<script>', null],
  [`utm_source=${'a'.repeat(101)}`, null],
  ['utm_source=linkedin&utm_medium=a%20b', { source: 'linkedin', medium: null, campaign: null }],
])('parseSignupSource(%j)', (raw, expected) => {
  expect(parseSignupSource(raw)).toEqual(expected);
});

test('a password signup records the source of its header', async () => {
  await post(
    '/api/auth/sign-up/email',
    { email: 'nova@example.com', password: PASSWORD, name: 'Nova' },
    { [SIGNUP_SOURCE_HEADER]: 'utm_source=instagram&utm_medium=bio' },
  );
  expect(sourceOf('nova@example.com')).toEqual({
    source: 'instagram',
    medium: 'bio',
    campaign: null,
  });
});

test('a code login that creates the user records the source, and a later login does not change it', async () => {
  const login = async (source: string) => {
    await post('/api/auth/email-otp/send-verification-otp', {
      email: 'nova@example.com',
      type: 'sign-in',
    });
    await post(
      '/api/auth/sign-in/email-otp',
      { email: 'nova@example.com', otp: lastCode() },
      { [SIGNUP_SOURCE_HEADER]: source },
    );
  };
  await login('utm_source=whatsapp');
  await login('utm_source=facebook');
  expect(sourceOf('nova@example.com')).toEqual({
    source: 'whatsapp',
    medium: null,
    campaign: null,
  });
});

test('a signup without a source leaves the columns empty', async () => {
  await post('/api/auth/sign-up/email', {
    email: 'nova@example.com',
    password: PASSWORD,
    name: 'Nova',
  });
  expect(sourceOf('nova@example.com')).toEqual({ source: null, medium: null, campaign: null });
});
