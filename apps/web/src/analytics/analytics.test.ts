import { afterEach, expect, test, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

import { identifyUser, startAnalytics, stopAnalytics, track } from './analytics';

afterEach(() => {
  stopAnalytics();
  vi.clearAllMocks();
});

test('PostHog starts with the privacy options of the policy: no cookies, no recording, no page text', async () => {
  await startAnalytics({ token: 'phc_x', host: 'https://us.i.posthog.com' });
  expect(posthog.init).toHaveBeenCalledWith(
    'phc_x',
    expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      persistence: 'memory',
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: true,
    }),
  );
});

test('without a token nothing loads, and events go nowhere', async () => {
  await startAnalytics(null);
  track('invoice_issued', { kind: 'new' });
  identifyUser('u1');
  expect(posthog.init).not.toHaveBeenCalled();
  expect(posthog.capture).not.toHaveBeenCalled();
});

test('a user is known by the internal id alone', async () => {
  await startAnalytics({ token: 'phc_x', host: 'https://us.i.posthog.com' });
  identifyUser('u1');
  expect(posthog.identify).toHaveBeenCalledWith('u1');
});
