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

test('the metrics listener is on port 9464 unless told otherwise; 0 turns it off', () => {
  expect(loadConfig(base).metricsPort).toBe(9464);
  expect(loadConfig({ ...base, METRICS_PORT: '9100' }).metricsPort).toBe(9100);
  expect(loadConfig({ ...base, METRICS_PORT: '0' }).metricsPort).toBeNull();
  expect(() => loadConfig({ ...base, METRICS_PORT: 'x' })).toThrow(/METRICS_PORT/);
});

test('Sentry is on only with a DSN; the release is the tag of the running image', () => {
  expect(loadConfig(base).sentry).toEqual({ serverDsn: null, webDsn: null, release: null });
  expect(
    loadConfig({
      ...base,
      SENTRY_DSN_SERVER: 'https://a@o1.ingest.us.sentry.io/1',
      SENTRY_DSN_WEB: 'https://b@o1.ingest.us.sentry.io/2',
      IMAGE: 'ghcr.io/darkanum/notaflow:e3944dc',
    }).sentry,
  ).toEqual({
    serverDsn: 'https://a@o1.ingest.us.sentry.io/1',
    webDsn: 'https://b@o1.ingest.us.sentry.io/2',
    release: 'e3944dc',
  });
  const pinned = { IMAGE: `ghcr.io/vapulab/notaflow@sha256:${'a'.repeat(64)}`, RELEASE: 'e3944dc' };
  expect(loadConfig({ ...base, ...pinned }).sentry.release).toBe('e3944dc');
  expect(() => loadConfig({ ...base, SENTRY_DSN_WEB: 'not a url' })).toThrow(/SENTRY_DSN_WEB/);
});

test('LIFECYCLE_START_AT is the day the reminders start, at midnight in Sao Paulo; unset means never', () => {
  expect(loadConfig(base).lifecycleStartAt).toBeNull();
  expect(loadConfig({ ...base, LIFECYCLE_START_AT: '2026-10-28' }).lifecycleStartAt).toEqual(
    new Date('2026-10-28T03:00:00Z'),
  );
  expect(() => loadConfig({ ...base, LIFECYCLE_START_AT: '28/10/2026' })).toThrow(
    /LIFECYCLE_START_AT/,
  );
});

test('an impossible LIFECYCLE_START_AT is refused, so a typo never starts the reminders early', () => {
  for (const date of ['2026-13-01', '2026-02-30', '2026-00-10']) {
    expect(() => loadConfig({ ...base, LIFECYCLE_START_AT: date }), date).toThrow(
      /LIFECYCLE_START_AT/,
    );
  }
});

test('RESEND_WEBHOOK_SECRET without the whsec_ prefix is a problem', () => {
  expect(loadConfig(base).mail.resendWebhookSecret).toBeNull();
  const secret = `whsec_${Buffer.alloc(32, 3).toString('base64')}`;
  expect(loadConfig({ ...base, RESEND_WEBHOOK_SECRET: secret }).mail.resendWebhookSecret).toBe(
    secret,
  );
  for (const value of [Buffer.alloc(32, 3).toString('base64'), 'whsec_']) {
    expect(problemsOf({ ...base, RESEND_WEBHOOK_SECRET: value }), value).toEqual([
      'RESEND_WEBHOOK_SECRET must be whsec_ followed by the base64 key',
    ]);
  }
});

test('every bug report channel is off until its variables are set', () => {
  expect(loadConfig(base).bugs).toEqual({
    github: null,
    githubWebhookSecret: null,
    discordWebhookUrl: null,
    notion: null,
    r2: null,
  });
  expect(
    loadConfig({
      ...base,
      GITHUB_BUG_TOKEN: 'gh-token',
      GITHUB_BUG_REPO: 'Vapulab/notaflow',
      GITHUB_WEBHOOK_SECRET: 'hook-secret',
      DISCORD_BUG_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
      NOTION_TOKEN: 'notion-token',
      NOTION_BUGS_DATABASE_ID: 'db-id',
    }).bugs,
  ).toEqual({
    github: { token: 'gh-token', repo: 'Vapulab/notaflow' },
    githubWebhookSecret: 'hook-secret',
    discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
    notion: { token: 'notion-token', databaseId: 'db-id' },
    r2: null,
  });
});

const R2 = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_BUG_REPORTS_ACCESS_KEY_ID: 'r2-key-id',
  R2_BUG_REPORTS_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUG_REPORTS_BUCKET: 'notaflow-bug-screenshots',
};

test('the screenshot bucket is on only with its four variables', () => {
  expect(loadConfig({ ...base, ...R2 }).bugs.r2).toEqual({
    accountId: R2.R2_ACCOUNT_ID,
    accessKeyId: 'r2-key-id',
    secretAccessKey: 'r2-secret',
    bucket: 'notaflow-bug-screenshots',
  });
  expect(problemsOf({ ...base, ...R2, R2_BUG_REPORTS_SECRET_ACCESS_KEY: '' })).toContain(
    'R2_ACCOUNT_ID, R2_BUG_REPORTS_ACCESS_KEY_ID, R2_BUG_REPORTS_SECRET_ACCESS_KEY, and R2_BUG_REPORTS_BUCKET go together',
  );
  expect(problemsOf({ ...base, ...R2, R2_ACCOUNT_ID: 'acc' })).toContain(
    'R2_ACCOUNT_ID must be the 32-character Cloudflare account id',
  );
  expect(problemsOf({ ...base, ...R2, R2_BUG_REPORTS_BUCKET: 'Bugs_Bucket' })).toContain(
    'R2_BUG_REPORTS_BUCKET must be a bucket name: lowercase letters, digits, and hyphens',
  );
});

test('a bug channel with half of its pair, a bad repo, or a plain-http webhook is refused', () => {
  expect(problemsOf({ ...base, GITHUB_BUG_TOKEN: 'x' })).toContain(
    'GITHUB_BUG_TOKEN and GITHUB_BUG_REPO go together',
  );
  expect(problemsOf({ ...base, GITHUB_BUG_TOKEN: 'x', GITHUB_BUG_REPO: 'notaflow' })).toContain(
    'GITHUB_BUG_REPO must be owner/name',
  );
  expect(problemsOf({ ...base, NOTION_BUGS_DATABASE_ID: 'x' })).toContain(
    'NOTION_TOKEN and NOTION_BUGS_DATABASE_ID go together',
  );
  for (const url of ['http://discord.com/api/webhooks/1/abc', 'not a url']) {
    expect(problemsOf({ ...base, DISCORD_BUG_WEBHOOK_URL: url }), url).toContain(
      'DISCORD_BUG_WEBHOOK_URL must be an https URL',
    );
  }
});

const DANFSE = {
  REDIS_URL: 'redis://redis:6379',
  R2_ACCOUNT_ID: R2.R2_ACCOUNT_ID,
  R2_DANFSE_ACCESS_KEY_ID: 'danfse-key-id',
  R2_DANFSE_SECRET_ACCESS_KEY: 'danfse-secret',
  R2_DANFSE_BUCKET: 'notaflow-danfse',
};

test('the DANFSe queue is off without REDIS_URL and on with all five variables', () => {
  expect(loadConfig(base).danfse).toBeNull();
  expect(loadConfig({ ...base, ...DANFSE }).danfse).toEqual({
    redisUrl: 'redis://redis:6379',
    r2: {
      accountId: R2.R2_ACCOUNT_ID,
      accessKeyId: 'danfse-key-id',
      secretAccessKey: 'danfse-secret',
      bucket: 'notaflow-danfse',
    },
  });
});

test('a partial DANFSe setup, a bad Redis URL, or a bad bucket name only turns the queue off', () => {
  const together =
    'REDIS_URL, R2_ACCOUNT_ID, R2_DANFSE_ACCESS_KEY_ID, R2_DANFSE_SECRET_ACCESS_KEY, and R2_DANFSE_BUCKET go together';
  const warningsOf = (env: Record<string, string | undefined>) => {
    expect(problemsOf(env)).toEqual([]);
    const config = loadConfig(env);
    expect(config.danfse).toBeNull();
    return config.danfseWarnings;
  };
  expect(warningsOf({ ...base, ...DANFSE, R2_DANFSE_SECRET_ACCESS_KEY: '' })).toContain(together);
  expect(warningsOf({ ...base, REDIS_URL: 'redis://redis:6379' })).toContain(together);
  expect(warningsOf({ ...base, R2_DANFSE_BUCKET: 'notaflow-danfse' })).toContain(together);
  expect(warningsOf({ ...base, ...DANFSE, REDIS_URL: 'http://redis' })).toContain(
    'REDIS_URL must be a redis: URL',
  );
  expect(warningsOf({ ...base, ...DANFSE, R2_DANFSE_BUCKET: 'Bad_Bucket' })).toContain(
    'R2_DANFSE_BUCKET must be a bucket name: lowercase letters, digits, and hyphens',
  );
});

test('a good or absent DANFSe setup has no warnings', () => {
  expect(loadConfig(base).danfseWarnings).toEqual([]);
  expect(loadConfig({ ...base, ...DANFSE }).danfseWarnings).toEqual([]);
});

test('a bad R2_ACCOUNT_ID still fails the config, because the bug reports share it', () => {
  expect(problemsOf({ ...base, ...DANFSE, R2_ACCOUNT_ID: 'acc' })).toContain(
    'R2_ACCOUNT_ID must be the 32-character Cloudflare account id',
  );
});

test('MAIL_FROM_INVOICE is optional and null when unset', () => {
  expect(loadConfig(base).mail.invoiceFrom).toBeNull();
  expect(loadConfig({ ...base, MAIL_FROM_INVOICE: 'Notas <n@example.com>' }).mail.invoiceFrom).toBe(
    'Notas <n@example.com>',
  );
});
