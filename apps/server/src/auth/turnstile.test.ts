import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

let t: TestApp;
let previous: Dispatcher;
let agent: MockAgent;
let n = 0;
let ip = '';
const verified: string[] = [];

beforeEach(async () => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  verified.length = 0;
  agent
    .get('https://challenges.cloudflare.com')
    .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
    .reply(200, (options) => {
      const body = String(options.body);
      verified.push(body);
      return { success: body.includes('good-token') };
    })
    .persist();
  n += 1;
  ip = `198.18.1.${n}`;
  t = await createTestApp({
    env: { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'turnstile-secret' },
  });
});
afterEach(async () => {
  await t.close();
  setGlobalDispatcher(previous);
});

const askCode = (headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    payload: { email: 'pessoa@example.com', type: 'sign-in' },
    remoteAddress: ip,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  });

test('sending a code without a Turnstile token is refused, and no e-mail goes out', async () => {
  const response = await askCode();
  expect(response.statusCode).toBe(400);
  expect(t.mail).toHaveLength(0);
});

test('a token Cloudflare refuses is refused', async () => {
  const response = await askCode({ 'x-captcha-response': 'bad-token' });
  expect(response.statusCode).toBe(403);
  expect(t.mail).toHaveLength(0);
});

test('a good token sends the code; Cloudflare gets the secret and the client IP', async () => {
  const response = await askCode({ 'x-captcha-response': 'good-token' });
  expect(response.statusCode).toBe(200);
  expect(t.mail).toHaveLength(1);
  expect(verified[0]).toContain('turnstile-secret');
  expect(verified[0]).toContain(ip);
});

test('the public configuration gives the site key, never the secret', async () => {
  const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(response.json()).toMatchObject({ turnstileSiteKey: 'site-key' });
  expect(response.body).not.toContain('turnstile-secret');
});
