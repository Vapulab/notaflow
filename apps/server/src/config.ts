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
  mail: { from: string; resendApiKey: string | null };
  google: { clientId: string; clientSecret: string } | null;
  turnstile: { siteKey: string; secretKey: string } | null;
  signup: { open: boolean; limitPerIpPerDay: number };
  // The project key is public by design: the browser sends it with every event.
  posthog: { token: string; host: string } | null;
  // Only behind the Cloudflare tunnel: then cf-connecting-ip is the real client IP.
  trustCloudflareIp: boolean;
  // The Prometheus listener, inside the container only; null turns it off.
  metricsPort: number | null;
  nacionalUrls?: { sefin: string; adn: string };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
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

  const trustCloudflareIp = env.TRUST_CLOUDFLARE_IP ?? 'false';
  if (trustCloudflareIp !== 'true' && trustCloudflareIp !== 'false') {
    problems.push('TRUST_CLOUDFLARE_IP must be true or false');
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
    mail: { from: env.MAIL_FROM || 'NotaFlow <nao-responda@notaflow.vapulab.com>', resendApiKey },
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
    posthog: env.POSTHOG_TOKEN
      ? { token: env.POSTHOG_TOKEN, host: env.POSTHOG_HOST || 'https://us.i.posthog.com' }
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
