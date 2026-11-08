import type { R2Client } from '@notaflow/r2';
import type { Metrics } from '../metrics/metrics';
import type { ErrorReporter } from '../observability/errors';
import type { ReportJob, ReportJobRepository } from '../repos/ReportJobRepository';
import {
  RenderFailedError,
  RenderTimeoutError,
  renderInThread,
  stackFrames,
} from './renderInThread';

const MAX_PARALLEL = 2;
const MAX_RUN_MS = 300_000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const MODULE = 'reports';

// The step that failed: the Sentry tag, the log field, and what to look at first.
export type ReportStage = 'render' | 'storage' | 'timeout' | 'expiry' | 'tick';

export type ReportLog = {
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
};

export type ReportRunnerDeps = {
  jobs: ReportJobRepository;
  r2: Pick<R2Client, 'put' | 'delete'>;
  log: ReportLog;
  errors: ErrorReporter;
  render?: typeof renderInThread;
  metrics?: Pick<Metrics, 'reportRendered' | 'reportJob' | 'reportExpiryFailed'>;
  now?: () => Date;
};

// A render error message may hold row data: only the type and the code lines go on.
function withoutMessage(error: unknown): RenderFailedError {
  if (error instanceof RenderFailedError) return error;
  const type = error instanceof Error ? error.name : typeof error;
  return new RenderFailedError('exception', type, stackFrames(error));
}

export class ReportRunner {
  private readonly render: typeof renderInThread;
  private readonly now: () => Date;

  constructor(private readonly deps: ReportRunnerDeps) {
    this.render = deps.render ?? renderInThread;
    this.now = deps.now ?? (() => new Date());
  }

  recoverOnStart(): { retried: number; failed: number } {
    const recovered = this.deps.jobs.recoverRunning();
    if (recovered.retried > 0) {
      this.deps.log.info(
        { module: MODULE, retried: recovered.retried },
        'report renders recovered',
      );
    }
    this.timedOut(recovered, 'a restart interrupted');
    return recovered;
  }

  async tick(): Promise<void> {
    try {
      this.timedOut(this.deps.jobs.failStale(this.now(), MAX_RUN_MS), 'ran too long');
      const running: Promise<void>[] = [];
      for (let i = 0; i < MAX_PARALLEL; i += 1) {
        const job = this.deps.jobs.claimNext(this.now());
        if (!job) break;
        running.push(this.run(job));
      }
      await Promise.allSettled(running);
    } catch (error) {
      this.report(error, 'tick', null, 'report tick failed');
    }
  }

  async expire(): Promise<number> {
    let expired = 0;
    for (const due of this.deps.jobs.dueForExpiry(this.now())) {
      try {
        await this.deps.r2.delete(due.r2Key);
        this.deps.jobs.markExpired(due.id);
        expired += 1;
      } catch (error) {
        this.deps.metrics?.reportExpiryFailed();
        this.report(error, 'expiry', due.id, 'report expiry failed');
      }
    }
    return expired;
  }

  private async run(job: ReportJob): Promise<void> {
    const { report } = job;
    const started = Date.now();
    this.deps.log.info(
      { module: MODULE, reportId: report.id, period: report.periodType, attempt: report.attempts },
      'report render started',
    );
    let result: Awaited<ReturnType<typeof renderInThread>>;
    try {
      result = await this.render({
        emitter: job.emitter,
        period: { type: report.periodType, from: report.periodFrom, to: report.periodTo },
        generatedAt: this.now().toISOString(),
        rows: this.deps.jobs.invoices(job),
      });
    } catch (error) {
      if (error instanceof RenderTimeoutError) {
        return this.fail(report.id, 'timeout', 'timeout', error);
      }
      return this.fail(report.id, 'render_failed', 'render', withoutMessage(error));
    }
    const r2Key = `reports/${report.accountId}/${report.id}.pdf`;
    try {
      await this.deps.r2.put(r2Key, result.pdf, 'application/pdf');
    } catch (error) {
      return this.fail(report.id, 'storage_failed', 'storage', error);
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
    const seconds = (Date.now() - started) / 1000;
    this.deps.metrics?.reportRendered(seconds, result.invoiceCount);
    this.deps.metrics?.reportJob('ready');
    this.deps.log.info(
      {
        module: MODULE,
        reportId: report.id,
        period: report.periodType,
        seconds,
        invoices: result.invoiceCount,
        pages: result.pages,
        bytes: result.pdf.length,
      },
      'report ready',
    );
  }

  private fail(reportId: string, code: string, stage: ReportStage, error: unknown): void {
    this.deps.jobs.markFailed(reportId, code);
    this.deps.metrics?.reportJob('failed');
    this.report(error, stage, reportId, `report failed: ${code}`, { code });
  }

  private timedOut(counts: { failed: number }, why: string): void {
    for (let i = 0; i < counts.failed; i += 1) this.deps.metrics?.reportJob('failed');
    if (counts.failed === 0) return;
    const message = `${counts.failed} report renders failed with timeout: ${why}`;
    this.deps.log.error({ module: MODULE, stage: 'timeout', failed: counts.failed }, message);
    this.deps.errors.capture(new RenderTimeoutError(), {
      module: MODULE,
      tags: { stage: 'timeout' },
    });
  }

  private report(
    error: unknown,
    stage: ReportStage,
    reportId: string | null,
    message: string,
    extra: Record<string, string> = {},
  ): void {
    const ids = reportId ? { reportId } : {};
    const reason = error instanceof RenderFailedError ? { reason: error.reason } : {};
    this.deps.log.error(
      { module: MODULE, stage, ...ids, ...reason, ...extra, err: error },
      message,
    );
    this.deps.errors.capture(error, {
      module: MODULE,
      tags: { stage, ...(reportId ? { report_id: reportId } : {}), ...reason },
    });
  }
}
