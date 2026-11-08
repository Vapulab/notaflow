import { expect, test } from 'vitest';
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
  danfseFailedCount: () => 0,
  reportOldestPendingSeconds: () => 0,
  reportCounts: () => [],
};

test('the job series start at 0, so the first failure after a restart is an increase', async () => {
  const m = new Metrics(sources);
  const text = await m.render();
  expect(text).toContain('report_jobs_total{result="ready"} 0');
  expect(text).toContain('report_jobs_total{result="failed"} 0');
  m.reportJob('failed');
  m.reportExpiryFailed();
  const after = await m.render();
  expect(after).toContain('report_jobs_total{result="failed"} 1');
  expect(after).toContain('report_expiry_failures_total 1');
});

test('the reports gauge follows the database rows by status and period', async () => {
  let rows = [
    { status: 'ready', period: 'month', count: 4 },
    { status: 'failed', period: 'year', count: 1 },
  ];
  const m = new Metrics({ ...sources, reportCounts: () => rows });
  const text = await m.render();
  expect(text).toContain('notaflow_reports{status="ready",period="month"} 4');
  expect(text).toContain('notaflow_reports{status="failed",period="year"} 1');
  rows = [];
  expect(await m.render()).not.toContain('notaflow_reports{');
});
