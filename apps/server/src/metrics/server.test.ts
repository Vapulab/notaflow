import { afterEach, expect, test } from 'vitest';
import { Metrics } from './metrics';
import { startMetricsServer } from './server';

const sources = {
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
};
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
});

test('the metrics listener answers /metrics in the Prometheus format, and nothing else', async () => {
  const server = await startMetricsServer(new Metrics(sources), { host: '127.0.0.1', port: 0 });
  stop = server.close;
  const metrics = await fetch(`http://127.0.0.1:${server.port}/metrics`);
  expect(metrics.status).toBe(200);
  expect(metrics.headers.get('content-type')).toContain('text/plain');
  expect(await metrics.text()).toContain('mail_outbox_messages');
  expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${server.port}/api/me`)).status).toBe(404);
});
