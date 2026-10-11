import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { GoogleProfile } from 'better-auth/social-providers';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, ORIGIN, type TestApp } from '../../test/testApp';

let t: TestApp;
let previous: Dispatcher;
let n = 0;
let ip = '';
let profile = { email: 'pessoa@example.com', name: 'Pessoa', emailVerified: true };

async function start(env: Record<string, string> = {}) {
  t = await createTestApp({
    env: { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret', ...env },
    // Better Auth keys the Google account by the profile's sub.
    googleUserInfo: async () => ({
      user: profile,
      // Only sub is read from the raw profile; the rest of GoogleProfile is irrelevant here.
      data: { sub: 'g-1', ...profile } as unknown as GoogleProfile,
    }),
  });
}

beforeEach(() => {
  previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  agent
    .get('https://oauth2.googleapis.com')
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, {
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: 'x.y.z',
    })
    .persist();
  n += 1;
  ip = `198.18.2.${n}`;
  profile = { email: 'pessoa@example.com', name: 'Pessoa', emailVerified: true };
});
afterEach(async () => {
  await t.close();
  setGlobalDispatcher(previous);
});

const cookiesOf = (response: { headers: Record<string, unknown> }) =>
  [response.headers['set-cookie']]
    .flat()
    .filter((c) => c !== undefined)
    .map((c) => String(c).split(';')[0]);

// Starts the Google login, then comes back from Google with a code, as the browser would.
async function googleLogin() {
  const start = await t.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/social',
    payload: { provider: 'google', callbackURL: '/app' },
    remoteAddress: ip,
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
  });
  expect(start.statusCode).toBe(200);
  const url = new URL((start.json() as { url: string }).url);
  expect(url.hostname).toBe('accounts.google.com');
  const state = url.searchParams.get('state') ?? '';
  return t.app.inject({
    method: 'GET',
    url: `/api/auth/callback/google?code=abc&state=${encodeURIComponent(state)}`,
    remoteAddress: ip,
    headers: { cookie: cookiesOf(start).join('; ') },
  });
}

const googleAccounts = () =>
  t.db.$client.prepare("SELECT user_id FROM auth_accounts WHERE provider_id = 'google'").all();
const verify = (userId: string) =>
  t.db.$client.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);

test('a verified Google e-mail of an existing user logs in that user and links Google', async () => {
  await start();
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  verify(a.userId);
  const back = await googleLogin();
  expect(back.statusCode).toBe(302);
  expect(back.headers.location).toBe('/app');
  expect(cookiesOf(back).join(';')).toContain('notaflow.session_token=');
  expect(googleAccounts()).toEqual([{ user_id: a.userId }]);
  const actions = t.db.$client
    .prepare("SELECT action, detail, entity FROM audit_log WHERE action LIKE 'auth.%'")
    .all();
  expect(actions).toEqual([
    { action: 'auth.google_linked', detail: null, entity: a.userId },
    { action: 'auth.login', detail: 'google', entity: a.userId },
  ]);
});

test('an unverified Google e-mail never takes over an existing user', async () => {
  await start();
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  verify(a.userId);
  profile = { ...profile, emailVerified: false };
  const back = await googleLogin();
  expect(back.statusCode).toBe(302);
  expect(String(back.headers.location)).toContain('error=account_not_linked');
  expect(cookiesOf(back).join(';')).not.toContain('notaflow.session_token=');
  expect(googleAccounts()).toEqual([]);
});

test('a new Google e-mail is refused while signup is closed', async () => {
  await start({ SIGNUP_OPEN: 'false' });
  profile = { ...profile, email: 'nova@example.com' };
  const back = await googleLogin();
  expect(cookiesOf(back).join(';')).not.toContain('notaflow.session_token=');
  expect(String(back.headers.location)).toContain('signup_closed');
  expect(t.db.$client.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
});

test('unlinking Google is recorded, and only when another login method remains', async () => {
  await start();
  const a = seedTenant(t.db, { accountName: 'A', email: 'pessoa@example.com' });
  verify(a.userId);
  await googleLogin();
  const cookie = await t.cookieFor('pessoa@example.com');
  const google = t.db.$client
    .prepare("SELECT id FROM auth_accounts WHERE provider_id = 'google'")
    .get() as { id: string };
  const unlink = () =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/unlink-account',
      payload: { accountId: google.id },
      remoteAddress: ip,
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie },
    });
  expect((await unlink()).statusCode).toBe(400);
  t.db.$client
    .prepare(
      `INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES ('cred', ?, ?, 'credential', 'hash', 0, 0)`,
    )
    .run(a.userId, a.userId);
  expect((await unlink()).statusCode).toBe(200);
  expect(googleAccounts()).toEqual([]);
  const last = t.db.$client
    .prepare('SELECT action, entity FROM audit_log ORDER BY id DESC LIMIT 1')
    .get();
  expect(last).toEqual({ action: 'auth.google_unlinked', entity: a.userId });
});
