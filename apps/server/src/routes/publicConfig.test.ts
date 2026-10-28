import { afterEach, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp | undefined;
afterEach(() => t?.close());

test('the public configuration gives the PostHog project key and host, which are public', async () => {
  t = await createTestApp({ env: { POSTHOG_TOKEN: 'phc_public_key' } });
  const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(response.json()).toMatchObject({
    posthog: { token: 'phc_public_key', host: 'https://us.i.posthog.com' },
  });
});

test('without a token the app sends no analytics', async () => {
  t = await createTestApp();
  const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(response.json()).toMatchObject({ posthog: null });
});

test('the public configuration gives the browser Sentry DSN, the release, and the environment', async () => {
  t = await createTestApp({
    env: {
      SENTRY_DSN_WEB: 'https://abc@o1.ingest.us.sentry.io/2',
      IMAGE: 'ghcr.io/x/notaflow:abc1234',
    },
  });
  const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(response.json()).toMatchObject({
    sentry: {
      dsn: 'https://abc@o1.ingest.us.sentry.io/2',
      release: 'abc1234',
      environment: 'test',
    },
  });
});

test('without a browser DSN the browser reports no errors', async () => {
  t = await createTestApp();
  const response = await t.app.inject({ method: 'GET', url: '/api/public/config' });
  expect(response.json()).toMatchObject({ sentry: null });
});
