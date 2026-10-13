import { afterEach, expect, test, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  reset: vi.fn(),
  get_distinct_id: vi.fn(() => ''),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

import { identifyUser, startAnalytics, stopAnalytics, track } from './analytics';

afterEach(() => {
  stopAnalytics();
  vi.clearAllMocks();
});

test('PostHog starts with the privacy options of the policy: no cookies, and recordings with every text and input masked', async () => {
  await startAnalytics({ token: 'phc_x', host: 'https://us.i.posthog.com' });
  expect(posthog.init).toHaveBeenCalledWith(
    'phc_x',
    expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      persistence: 'memory',
      autocapture: false,
      disable_session_recording: false,
      enable_recording_console_log: false,
      mask_all_text: true,
      session_recording: expect.objectContaining({
        maskAllInputs: true,
        maskTextSelector: '*',
        recordCrossOriginIframes: false,
      }),
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

test('a user and events from before PostHog loads go out, in order, once it loads', async () => {
  identifyUser('u1');
  track('signup_completed', { method: 'google' });
  expect(posthog.capture).not.toHaveBeenCalled();
  await startAnalytics({ token: 'phc_x', host: 'https://us.i.posthog.com' });
  expect(posthog.reset).toHaveBeenCalledWith({
    bootstrap: { distinctID: 'u1', isIdentifiedID: true },
  });
  expect(posthog.capture).toHaveBeenCalledWith('signup_completed', { method: 'google' });
  expect(posthog.reset.mock.invocationCallOrder[0]).toBeLessThan(
    posthog.capture.mock.invocationCallOrder[0] ?? 0,
  );
});

test('a user is known by the internal id alone, set as the id, so page loads do not pile up merged ids', async () => {
  await startAnalytics({ token: 'phc_x', host: 'https://us.i.posthog.com' });
  posthog.get_distinct_id = vi.fn(() => 'anon-1');
  identifyUser('u1');
  expect(posthog.reset).toHaveBeenCalledWith({
    bootstrap: { distinctID: 'u1', isIdentifiedID: true },
  });
  expect(posthog.identify).not.toHaveBeenCalled();
  // Already that user: nothing to do.
  posthog.get_distinct_id = vi.fn(() => 'u1');
  identifyUser('u1');
  expect(posthog.reset).toHaveBeenCalledTimes(1);
});
