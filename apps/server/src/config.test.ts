import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './config';

const KEY = Buffer.alloc(32, 7).toString('base64');
const base = {
  NODE_ENV: 'production',
  DATABASE_PATH: 'data/notaflow.db',
  APP_ORIGIN: 'https://nfse.example.com',
  NFSE_MASTER_KEY: KEY,
  AUTH_MODE: 'session',
  BETTER_AUTH_SECRET: 's'.repeat(40),
  RESEND_API_KEY: 're_test',
  TURNSTILE_SITE_KEY: 'site-key',
  TURNSTILE_SECRET_KEY: 'secret-key',
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

test('reads a production configuration with the own login', () => {
  const config = loadConfig(base);
  expect(config).toMatchObject({
    nodeEnv: 'production',
    host: '127.0.0.1',
    port: 3000,
    appOrigin: 'https://nfse.example.com',
    auth: { mode: 'session' },
    authSecret: 's'.repeat(40),
    mail: { from: 'NotaFlow <nao-responda@notaflow.vapulab.com>', resendApiKey: 're_test' },
    google: null,
    turnstile: { siteKey: 'site-key', secretKey: 'secret-key' },
    signup: { open: false, limitPerIpPerDay: 5 },
  });
  expect(config.masterKey).toEqual(Buffer.alloc(32, 7));
  expect(config.nacionalUrls).toBeUndefined();
});

test('refuses AUTH_MODE=dev in production', () => {
  expect(problemsOf({ ...base, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'a@b.c' })).toContain(
    'AUTH_MODE=dev is not allowed with NODE_ENV=production',
  );
});

test('refuses the fake national system in production', () => {
  expect(problemsOf({ ...base, NACIONAL_FAKE_URL: 'http://127.0.0.1:4010' })).toContain(
    'NACIONAL_FAKE_URL is not allowed with NODE_ENV=production',
  );
});

test('dev mode needs DEV_USER_EMAIL and lower-cases it', () => {
  const dev = { ...base, NODE_ENV: 'development', AUTH_MODE: 'dev' };
  expect(problemsOf(dev)).toContain('DEV_USER_EMAIL is required with AUTH_MODE=dev');
  expect(loadConfig({ ...dev, DEV_USER_EMAIL: 'Dev@Example.com' }).auth).toEqual({
    mode: 'dev',
    email: 'dev@example.com',
  });
});

test('the fake URL becomes the Sefin and ADN base URLs', () => {
  const config = loadConfig({
    ...base,
    NODE_ENV: 'development',
    NACIONAL_FAKE_URL: 'http://127.0.0.1:4010',
  });
  expect(config.nacionalUrls).toEqual({
    sefin: 'http://127.0.0.1:4010/SefinNacional',
    adn: 'http://127.0.0.1:4010/adn',
  });
});

test('lists every problem at once', () => {
  const problems = problemsOf({ NODE_ENV: 'production', NFSE_MASTER_KEY: 'c2hvcnQ=' });
  expect(problems).toEqual(
    expect.arrayContaining([
      'DATABASE_PATH is required',
      'APP_ORIGIN is required',
      'NFSE_MASTER_KEY must be 32 bytes in base64',
      'AUTH_MODE must be session or dev',
    ]),
  );
});

test('APP_ORIGIN must be a bare origin, so the Origin check can match the browser', () => {
  expect(problemsOf({ ...base, APP_ORIGIN: 'https://nfse.example.com/' })).toContain(
    'APP_ORIGIN must be an origin such as https://nfse.example.com, with no path or trailing slash',
  );
  expect(problemsOf({ ...base, APP_ORIGIN: 'not a url' })).toContain(
    'APP_ORIGIN must be an origin such as https://nfse.example.com, with no path or trailing slash',
  );
});

test('AUTH_MODE=access is gone', () => {
  expect(problemsOf({ ...base, AUTH_MODE: 'access' })).toContain(
    'AUTH_MODE must be session or dev',
  );
});

test('BETTER_AUTH_SECRET needs at least 32 characters', () => {
  expect(problemsOf({ ...base, BETTER_AUTH_SECRET: 'short' })).toContain(
    'BETTER_AUTH_SECRET must have at least 32 characters',
  );
  expect(problemsOf({ ...base, BETTER_AUTH_SECRET: undefined })).toContain(
    'BETTER_AUTH_SECRET must have at least 32 characters',
  );
});

test('production needs the Resend key and both Turnstile keys', () => {
  const problems = problemsOf({
    ...base,
    RESEND_API_KEY: undefined,
    TURNSTILE_SITE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
  });
  expect(problems).toEqual(
    expect.arrayContaining([
      'RESEND_API_KEY is required in production',
      'TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required in production',
    ]),
  );
});

test('Google and Turnstile keys come in pairs; neither turns the feature off outside production', () => {
  const dev = {
    ...base,
    NODE_ENV: 'development',
    TURNSTILE_SITE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
  };
  expect(loadConfig(dev)).toMatchObject({ google: null, turnstile: null });
  expect(problemsOf({ ...dev, GOOGLE_CLIENT_ID: 'id' })).toContain(
    'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together',
  );
  expect(problemsOf({ ...dev, GOOGLE_CLIENT_SECRET: 'secret' })).toContain(
    'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together',
  );
  expect(problemsOf({ ...dev, TURNSTILE_SITE_KEY: 'site' })).toContain(
    'TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY go together',
  );
  expect(
    loadConfig({ ...dev, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).google,
  ).toEqual({
    clientId: 'id',
    clientSecret: 'secret',
  });
});

test('SIGNUP_OPEN is true or false, closed by default; the per-IP limit is 1 to 1000', () => {
  expect(
    loadConfig({ ...base, SIGNUP_OPEN: 'true', SIGNUP_LIMIT_PER_IP_DAY: '20' }).signup,
  ).toEqual({
    open: true,
    limitPerIpPerDay: 20,
  });
  expect(problemsOf({ ...base, SIGNUP_OPEN: 'yes' })).toContain(
    'SIGNUP_OPEN must be true or false',
  );
  expect(problemsOf({ ...base, SIGNUP_LIMIT_PER_IP_DAY: '0' })).toContain(
    'SIGNUP_LIMIT_PER_IP_DAY must be a whole number from 1 to 1000',
  );
});

test('MAIL_FROM can be replaced', () => {
  expect(loadConfig({ ...base, MAIL_FROM: 'Teste <t@example.com>' }).mail.from).toBe(
    'Teste <t@example.com>',
  );
});

test('dev mode needs no BETTER_AUTH_SECRET', () => {
  const config = loadConfig({
    ...base,
    NODE_ENV: 'development',
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'dev@example.com',
    BETTER_AUTH_SECRET: undefined,
  });
  expect(config.authSecret.length).toBeGreaterThanOrEqual(32);
});

test('PORT must be a whole number from 1 to 65535', () => {
  expect(problemsOf({ ...base, PORT: 'abc' })).toContain(
    'PORT must be a whole number from 1 to 65535',
  );
  expect(loadConfig({ ...base, PORT: '8080' }).port).toBe(8080);
});

test('production needs an https APP_ORIGIN, so the session cookie is Secure', () => {
  expect(problemsOf({ ...base, APP_ORIGIN: 'http://nfse.example.com' })).toContain(
    'APP_ORIGIN must use https in production',
  );
  expect(
    problemsOf({ ...base, NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:3000' }),
  ).toEqual([]);
});

test('PostHog is on only with a token, at the US host unless told otherwise', () => {
  expect(loadConfig(base).posthog).toBeNull();
  expect(loadConfig({ ...base, POSTHOG_TOKEN: 'phc_test' }).posthog).toEqual({
    token: 'phc_test',
    host: 'https://us.i.posthog.com',
  });
  expect(
    loadConfig({ ...base, POSTHOG_TOKEN: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com' })
      .posthog,
  ).toEqual({ token: 'phc_test', host: 'https://eu.i.posthog.com' });
});
