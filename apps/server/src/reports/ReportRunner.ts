import type { R2Client } from '@notaflow/r2';
import type { Metrics } from '../metrics/metrics';
import type { ReportJob, ReportJobRepository } from '../repos/ReportJobRepository';
import { RenderTimeoutError, renderInThread } from './renderInThread';

const MAX_PARALLEL = 2;
const MAX_RUN_MS = 300_000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export type ReportRunnerDeps = {
  jobs: ReportJobRepository;
  r2: Pick<R2Client, 'put' | 'delete'>;
  render?: typeof renderInThread;
  metrics?: Pick<Metrics, 'reportRendered' | 'reportJob'>;
  now?: () => Date;
};

export class ReportRunner {
  private readonly render: typeof renderInThread;
  private readonly now: () => Date;

  constructor(private readonly deps: ReportRunnerDeps) {
    this.render = deps.render ?? renderInThread;
    this.now = deps.now ?? (() => new Date());
  }

  recoverOnStart(): number {
    return this.deps.jobs.recoverRunning();
  }

  async tick(): Promise<void> {
    try {
      this.deps.jobs.failStale(this.now(), MAX_RUN_MS);
      const running: Promise<void>[] = [];
      for (let i = 0; i < MAX_PARALLEL; i += 1) {
        const job = this.deps.jobs.claimNext(this.now());
        if (!job) break;
        running.push(this.run(job));
      }
      await Promise.allSettled(running);
    } catch {
      console.error('report tick failed');
    }
  }

  async expire(): Promise<number> {
    let expired = 0;
    for (const due of this.deps.jobs.dueForExpiry(this.now())) {
      try {
        await this.deps.r2.delete(due.r2Key);
        this.deps.jobs.markExpired(due.id);
        expired += 1;
      } catch {
        console.error(`report ${due.id} expiry failed`);
      }
    }
    return expired;
  }

  private async run(job: ReportJob): Promise<void> {
    const { report } = job;
    const started = Date.now();
    let code: string;
    try {
      const result = await this.render({
        emitter: job.emitter,
        period: { type: report.periodType, from: report.periodFrom, to: report.periodTo },
        generatedAt: this.now().toISOString(),
        rows: this.deps.jobs.invoices(job),
      });
      const r2Key = `reports/${report.accountId}/${report.id}.pdf`;
      try {
        await this.deps.r2.put(r2Key, result.pdf, 'application/pdf');
      } catch {
        return this.fail(report.id, 'storage_failed');
      }
      const readyAt = this.now();
      this.deps.jobs.markReady(report.id, {
        r2Key,
        invoiceCount: result.invoiceCount,
        pages: result.pages,
        bytes: result.pdf.length,
        readyAt,
        expiresAt: new Date(readyAt.getTime() + RETENTION_MS),
      });
      this.deps.metrics?.reportRendered((Date.now() - started) / 1000, result.invoiceCount);
      this.deps.metrics?.reportJob('ready');
      return;
    } catch (error) {
      code = error instanceof RenderTimeoutError ? 'timeout' : 'render_failed';
    }
    this.fail(report.id, code);
  }

  private fail(reportId: string, code: string): void {
    this.deps.jobs.markFailed(reportId, code);
    this.deps.metrics?.reportJob('failed');
    console.error(`report ${reportId} failed: ${code}`);
  }
}
