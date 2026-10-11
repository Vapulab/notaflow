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
