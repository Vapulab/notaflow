import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';

// What the login pages need before a session exists; only public values.
export function publicConfigRoutes(app: FastifyInstance, config: Config): void {
  app.get('/api/public/config', async () => ({
    googleEnabled: config.google !== null,
    turnstileSiteKey: config.turnstile?.siteKey ?? null,
    signupOpen: config.signup.open,
    posthog: config.posthog,
    sentry: config.sentry.webDsn
      ? { dsn: config.sentry.webDsn, release: config.sentry.release, environment: config.nodeEnv }
      : null,
  }));
}
