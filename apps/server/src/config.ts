import type { R2Settings } from '@notaflow/r2';

export type AuthConfig = { mode: 'session' } | { mode: 'dev'; email: string };

// Development only: dev mode skips the session, but Better Auth still needs a secret to start.
const DEV_AUTH_SECRET = 'notaflow-development-secret-not-for-production';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  appOrigin: string;
  masterKey: Buffer;
  auth: AuthConfig;
  authSecret: string;
  mail: { from: string; invoiceFrom: string | null; resendApiKey: string | null };
  google: { clientId: string; clientSecret: string } | null;
  turnstile: { siteKey: string; secretKey: string } | null;
  signup: { open: boolean; limitPerIpPerDay: number };
  // The project key is public by design: the browser sends it with every event.
  posthog: { token: string; host: string } | null;
  // Only behind the Cloudflare tunnel: then cf-connecting-ip is the real client IP.
  trustCloudflareIp: boolean;
  // The Prometheus listener, inside the container only; null turns it off.
  metricsPort: number | null;
  // The first day the lifecycle reminders may go out; null keeps them off.
  lifecycleStartAt: Date | null;
  // The release is the tag of the running image, so an error points at its commit.
  sentry: { serverDsn: string | null; webDsn: string | null; release: string | null };
  nacionalUrls?: { sefin: string; adn: string };
  // Where a bug report goes; each channel is off while its variables are unset.
  bugs: BugChannels;
  // The DANFSe PDF queue; null while REDIS_URL is unset, and the download then draws on demand.
  danfse: { redisUrl: string; r2: R2Settings } | null;
  // Why the queue is off although a DANFSe variable is set; the app logs and reports it, and keeps running.
  danfseWarnings: string[];
}

export interface BugChannels {
  github: { token: string; repo: string } | null;
  // The webhook route answers 404 while it is null.
  githubWebhookSecret: string | null;
  discordWebhookUrl: string | null;
  notion: { token: string; databaseId: string } | null;
  // The private bucket of the screenshots; null refuses images and keeps text-only reports.
  r2: R2Settings | null;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const danfseWarnings: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    problems.push('NODE_ENV must be development, test, or production');
  }
  const databasePath = required('DATABASE_PATH');
  const appOrigin = required('APP_ORIGIN');
  if (appOrigin && originOf(appOrigin) !== appOrigin) {
    problems.push(
      'APP_ORIGIN must be an origin such as https://nfse.example.com, with no path or trailing slash',
    );
  }
  if (nodeEnv === 'production' && appOrigin.startsWith('http://')) {
    problems.push('APP_ORIGIN must use https in production');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT must be a whole number from 1 to 65535');
  }
  const masterKey = Buffer.from(env.NFSE_MASTER_KEY ?? '', 'base64');
  if (masterKey.length !== 32) problems.push('NFSE_MASTER_KEY must be 32 bytes in base64');

  let auth: AuthConfig = { mode: 'dev', email: '' };
  let authSecret = env.BETTER_AUTH_SECRET ?? '';
  if (env.AUTH_MODE === 'session') {
    auth = { mode: 'session' };
    if (authSecret.length < 32)
      problems.push('BETTER_AUTH_SECRET must have at least 32 characters');
  } else if (env.AUTH_MODE === 'dev') {
    if (nodeEnv === 'production') {
      problems.push('AUTH_MODE=dev is not allowed with NODE_ENV=production');
    }
    if (!env.DEV_USER_EMAIL) problems.push('DEV_USER_EMAIL is required with AUTH_MODE=dev');
    auth = { mode: 'dev', email: (env.DEV_USER_EMAIL ?? '').toLowerCase() };
    if (authSecret.length < 32) authSecret = DEV_AUTH_SECRET;
  } else {
    problems.push('AUTH_MODE must be session or dev');
  }

  const resendApiKey = env.RESEND_API_KEY || null;
  if (!resendApiKey && nodeEnv === 'production') {
    problems.push('RESEND_API_KEY is required in production');
  }
  const google = pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  if (google === 'half') problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together');
  const turnstile = pair(env.TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET_KEY);
  if (turnstile === 'half') {
    problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY go together');
  } else if (turnstile === null && nodeEnv === 'production') {
    problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required in production');
  }
  const signupOpen = env.SIGNUP_OPEN ?? 'false';
  if (signupOpen !== 'true' && signupOpen !== 'false') {
    problems.push('SIGNUP_OPEN must be true or false');
  }
  const limitPerIpPerDay = Number(env.SIGNUP_LIMIT_PER_IP_DAY ?? 5);
  if (!Number.isInteger(limitPerIpPerDay) || limitPerIpPerDay < 1 || limitPerIpPerDay > 1000) {
    problems.push('SIGNUP_LIMIT_PER_IP_DAY must be a whole number from 1 to 1000');
  }

  const fake = env.NACIONAL_FAKE_URL;
  if (fake && nodeEnv === 'production') {
    problems.push('NACIONAL_FAKE_URL is not allowed with NODE_ENV=production');
  }

  const metricsPort = Number(env.METRICS_PORT ?? '9464');
  if (!Number.isInteger(metricsPort) || metricsPort < 0 || metricsPort > 65535) {
    problems.push('METRICS_PORT must be a port number, or 0 to turn it off');
  }

  const lifecycleStart = env.LIFECYCLE_START_AT || '';
  // The date must exist: Date turns 2026-02-30 into March 2 and 2026-13-01 into an invalid date.
  const lifecycleStartAt = lifecycleStart ? new Date(`${lifecycleStart}T00:00:00-03:00`) : null;
  const realDate =
    lifecycleStartAt !== null &&
    !Number.isNaN(lifecycleStartAt.getTime()) &&
    new Date(lifecycleStartAt.getTime() + 3 * 3600_000).toISOString().slice(0, 10) ===
      lifecycleStart;
  if (lifecycleStart && !realDate) {
    problems.push('LIFECYCLE_START_AT must be a date as YYYY-MM-DD');
  }

  const trustCloudflareIp = env.TRUST_CLOUDFLARE_IP ?? 'false';
  if (trustCloudflareIp !== 'true' && trustCloudflareIp !== 'false') {
    problems.push('TRUST_CLOUDFLARE_IP must be true or false');
  }

  for (const name of ['SENTRY_DSN_SERVER', 'SENTRY_DSN_WEB']) {
    const dsn = env[name];
    if (dsn && !URL.canParse(dsn)) problems.push(`${name} must be a Sentry DSN URL`);
  }

  const github = pair(env.GITHUB_BUG_TOKEN, env.GITHUB_BUG_REPO);
  if (github === 'half') problems.push('GITHUB_BUG_TOKEN and GITHUB_BUG_REPO go together');
  if (Array.isArray(github) && !/^[\w.-]+\/[\w.-]+$/.test(github[1])) {
    problems.push('GITHUB_BUG_REPO must be owner/name');
  }
  const notion = pair(env.NOTION_TOKEN, env.NOTION_BUGS_DATABASE_ID);
  if (notion === 'half') problems.push('NOTION_TOKEN and NOTION_BUGS_DATABASE_ID go together');
  const discord = env.DISCORD_BUG_WEBHOOK_URL || null;
  if (discord && (!URL.canParse(discord) || new URL(discord).protocol !== 'https:')) {
    problems.push('DISCORD_BUG_WEBHOOK_URL must be an https URL');
  }

  const r2Values = [
    'R2_ACCOUNT_ID',
    'R2_BUG_REPORTS_ACCESS_KEY_ID',
    'R2_BUG_REPORTS_SECRET_ACCESS_KEY',
    'R2_BUG_REPORTS_BUCKET',
  ].map((name) => env[name] || '');
  const [r2AccountId = '', r2KeyId = '', r2Secret = '', r2Bucket = ''] = r2Values;
  // R2_ACCOUNT_ID is shared with the DANFSe queue, so it alone does not count here.
  const r2Set = r2Values.filter(Boolean).length;
  const r2Own = r2Values.slice(1).filter(Boolean).length;
  if (r2Own > 0 && r2Set < 4) {
    problems.push(
      'R2_ACCOUNT_ID, R2_BUG_REPORTS_ACCESS_KEY_ID, R2_BUG_REPORTS_SECRET_ACCESS_KEY, and R2_BUG_REPORTS_BUCKET go together',
    );
  }
  if (r2AccountId && !/^[0-9a-f]{32}$/.test(r2AccountId)) {
    problems.push('R2_ACCOUNT_ID must be the 32-character Cloudflare account id');
  }
  if (r2Bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2Bucket)) {
    problems.push(
      'R2_BUG_REPORTS_BUCKET must be a bucket name: lowercase letters, digits, and hyphens',
    );
  }

  const redisUrl = env.REDIS_URL || '';
  const danfseKeyId = env.R2_DANFSE_ACCESS_KEY_ID || '';
  const danfseSecret = env.R2_DANFSE_SECRET_ACCESS_KEY || '';
  const danfseBucket = env.R2_DANFSE_BUCKET || '';
  const danfseOwn = [redisUrl, danfseKeyId, danfseSecret, danfseBucket];
  // R2_ACCOUNT_ID is shared with the bug reports, so it alone does not turn the queue on.
  const danfseOn = danfseOwn.every(Boolean) && Boolean(r2AccountId);
  if (danfseOwn.some(Boolean) && !danfseOn) {
    danfseWarnings.push(
      'REDIS_URL, R2_ACCOUNT_ID, R2_DANFSE_ACCESS_KEY_ID, R2_DANFSE_SECRET_ACCESS_KEY, and R2_DANFSE_BUCKET go together',
    );
  }
  if (redisUrl && (!URL.canParse(redisUrl) || new URL(redisUrl).protocol !== 'redis:')) {
    danfseWarnings.push('REDIS_URL must be a redis: URL');
  }
  if (danfseBucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(danfseBucket)) {
    danfseWarnings.push(
      'R2_DANFSE_BUCKET must be a bucket name: lowercase letters, digits, and hyphens',
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'],
    host: env.HOST ?? '127.0.0.1',
    port,
    databasePath,
    appOrigin,
    masterKey,
    auth,
    authSecret,
    mail: {
      from: env.MAIL_FROM || 'NotaFlow <nao-responda@notaflow.vapulab.com>',
      invoiceFrom: env.MAIL_FROM_INVOICE || null,
      resendApiKey,
    },
    google:
      google === null || google === 'half'
        ? null
        : { clientId: google[0], clientSecret: google[1] },
    turnstile:
      turnstile === null || turnstile === 'half'
        ? null
        : { siteKey: turnstile[0], secretKey: turnstile[1] },
    signup: { open: signupOpen === 'true', limitPerIpPerDay },
    trustCloudflareIp: trustCloudflareIp === 'true',
    metricsPort: metricsPort === 0 ? null : metricsPort,
    lifecycleStartAt,
    sentry: {
      serverDsn: env.SENTRY_DSN_SERVER || null,
      webDsn: env.SENTRY_DSN_WEB || null,
      release: /:([^:/]+)$/.exec(env.IMAGE ?? '')?.[1] ?? null,
    },
    posthog: env.POSTHOG_TOKEN
      ? { token: env.POSTHOG_TOKEN, host: env.POSTHOG_HOST || 'https://us.i.posthog.com' }
      : null,
    bugs: {
      github: Array.isArray(github) ? { token: github[0], repo: github[1] } : null,
      githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
      discordWebhookUrl: discord,
      notion: Array.isArray(notion) ? { token: notion[0], databaseId: notion[1] } : null,
      r2:
        r2Set === 4
          ? {
              accountId: r2AccountId,
              accessKeyId: r2KeyId,
              secretAccessKey: r2Secret,
              bucket: r2Bucket,
            }
          : null,
    },
    danfseWarnings,
    danfse:
      danfseOn && danfseWarnings.length === 0
        ? {
            redisUrl,
            r2: {
              accountId: r2AccountId,
              accessKeyId: danfseKeyId,
              secretAccessKey: danfseSecret,
              bucket: danfseBucket,
            },
          }
        : null,
    ...(fake ? { nacionalUrls: { sefin: `${fake}/SefinNacional`, adn: `${fake}/adn` } } : {}),
  };
}

// Both values, neither (null), or only one ('half').
function pair(a: string | undefined, b: string | undefined): [string, string] | null | 'half' {
  if (a && b) return [a, b];
  return a || b ? 'half' : null;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
