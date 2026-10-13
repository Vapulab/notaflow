// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import * as analytics from '../analytics/analytics';
import { meFor } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import { MeProvider } from './MeContext';

vi.mock('../analytics/analytics');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

test('back from a Google signup, the app counts it for that user, with the campaign', async () => {
  stubApi({ '/api/me': meFor('user') });
  window.history.replaceState(null, '', '/app?cadastro=google&utm_source=instagram');
  render(<MeProvider>{null}</MeProvider>);
  await waitFor(() =>
    expect(analytics.track).toHaveBeenCalledWith('signup_completed', {
      method: 'google',
      utm_source: 'instagram',
    }),
  );
  expect(vi.mocked(analytics.identifyUser).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(analytics.track).mock.invocationCallOrder[0] ?? 0,
  );
  expect(window.location.search).toBe('');
});

test('a plain page load counts no signup', async () => {
  stubApi({ '/api/me': meFor('user') });
  window.history.replaceState(null, '', '/app');
  render(<MeProvider>{null}</MeProvider>);
  await waitFor(() => expect(analytics.identifyUser).toHaveBeenCalled());
  expect(analytics.track).not.toHaveBeenCalled();
});
