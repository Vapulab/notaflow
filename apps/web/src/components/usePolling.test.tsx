// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { usePolling } from './usePolling';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

test('polls every 3 s and stops after 2 minutes of continuous polling', async () => {
  const refresh = vi.fn();
  renderHook(() => usePolling(true, refresh, false));
  await tick(120_000);
  expect(refresh).toHaveBeenCalledTimes(40);
  await tick(60_000);
  expect(refresh).toHaveBeenCalledTimes(40);
});

test('a new mount polls again after the limit', async () => {
  const refresh = vi.fn();
  const first = renderHook(() => usePolling(true, refresh, false));
  await tick(180_000);
  first.unmount();
  refresh.mockClear();
  renderHook(() => usePolling(true, refresh, false));
  await tick(3000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('going inactive and active again restarts the 2 minutes', async () => {
  const refresh = vi.fn();
  const view = renderHook(({ on }) => usePolling(on, refresh, false), {
    initialProps: { on: true },
  });
  await tick(90_000);
  view.rerender({ on: false });
  view.rerender({ on: true });
  refresh.mockClear();
  await tick(120_000);
  expect(refresh).toHaveBeenCalledTimes(40);
});
