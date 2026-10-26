import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Metrics, type MetricSources } from './metrics';

const sources: MetricSources = {
  outboxCounts: () => [],
  certificateExpiries: () => [],
  latestLocalBackup: () => null,
  accountCounts: () => [],
  userCount: () => 0,
  emitterCounts: () => [],
  invoiceCounts: () => [],
  lifecycleCounts: () => [],
  bugReportCounts: () => [],
  bugDeliveryCounts: () => [],
  bugImageCounts: () => [],
  danfsePendingOldest: () => null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

test('jobs count by result and renders land in the seconds histogram', async () => {
  const m = new Metrics(sources);
  m.danfseJob('completed');
  m.danfseJob('completed');
  m.danfseJob('failed');
  m.danfseRender(1.5);
  const text = await m.render();
  expect(text).toContain('danfse_jobs_total{result="completed"} 2');
  expect(text).toContain('danfse_jobs_total{result="failed"} 1');
  expect(text).toContain('danfse_render_seconds_count 1');
  expect(text).toContain('danfse_render_seconds_sum 1.5');
});

test('the oldest pending age is 0 with no pending row and counts seconds otherwise', async () => {
  let oldest: Date | null = null;
  const m = new Metrics({ ...sources, danfsePendingOldest: () => oldest });
  expect(await m.render()).toContain('danfse_pending_oldest_seconds 0');
  oldest = new Date('2026-10-26T11:30:00Z');
  expect(await m.render()).toContain('danfse_pending_oldest_seconds 1800');
});

test('without a queue the queue gauges are not exported', async () => {
  const text = await new Metrics(sources).render();
  expect(text).not.toContain('danfse_dlq_size');
  expect(text).not.toContain('danfse_workers');
});

test('the queue gauges read a cached counts() at most every 30 seconds', async () => {
  const counts = vi.fn().mockResolvedValue({ failed: 3, workers: 1 });
  const m = new Metrics(sources);
  m.watchDanfseQueue({ counts });
  await vi.waitFor(async () => expect(await m.render()).toContain('danfse_dlq_size 3'));
  expect(await m.render()).toContain('danfse_workers 1');
  expect(counts).toHaveBeenCalledTimes(1);
  counts.mockResolvedValue({ failed: 4, workers: 2 });
  vi.advanceTimersByTime(31_000);
  await m.render();
  await vi.waitFor(async () => expect(await m.render()).toContain('danfse_dlq_size 4'));
  expect(await m.render()).toContain('danfse_workers 2');
  expect(counts).toHaveBeenCalledTimes(2);
});

test('a scrape never waits on a slow queue, and reports no worker until counts() answers', async () => {
  const m = new Metrics(sources);
  m.watchDanfseQueue({ counts: () => new Promise(() => undefined) });
  await expect(m.render()).resolves.toContain('danfse_workers 0');
});

test('when counts() rejects, workers drop to 0 and the dead letters keep their last value', async () => {
  const counts = vi.fn().mockResolvedValue({ failed: 3, workers: 1 });
  const m = new Metrics(sources);
  m.watchDanfseQueue({ counts });
  await vi.waitFor(async () => expect(await m.render()).toContain('danfse_workers 1'));
  counts.mockRejectedValue(new Error('Redis is not ready'));
  vi.advanceTimersByTime(31_000);
  await m.render();
  await vi.waitFor(async () => expect(await m.render()).toContain('danfse_workers 0'));
  expect(await m.render()).toContain('danfse_dlq_size 3');
});
