import { markFor } from '@notaflow/danfse-pdf';
import type { DanfseRepository } from '../repos/DanfseRepository';
import { type DanfseQueue, type DanfseQueueEvents, parseJobId } from './queue';

export interface DanfseMetrics {
  job(result: 'completed' | 'failed'): void;
  render(seconds: number): void;
}

export interface DanfseDispatcherDeps {
  repo: DanfseRepository;
  queue: DanfseQueue;
  metrics: DanfseMetrics;
  log: (msg: string, data?: object) => void;
  now?: () => Date;
}

const SWEEP_LIMIT = 100;

export class DanfseDispatcher {
  private readonly now: () => Date;
  private redisDown = false;

  constructor(private readonly deps: DanfseDispatcherDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async sweep(): Promise<number> {
    const { repo, queue, log } = this.deps;
    const now = this.now();
    let enqueued = 0;
    for (const row of repo.due(now, SWEEP_LIMIT)) {
      const mark = markFor(row.status, row.eventCodes);
      try {
        await queue.add({
          invoiceId: row.id,
          accessKey: row.accessKey,
          mark,
          xmlGzipBase64: row.xmlGzip.toString('base64'),
        });
      } catch (error) {
        // Redis is down: stop the run and leave every row pending for the next one.
        if (!this.redisDown) {
          this.redisDown = true;
          log('DANFSe sweep stopped, the queue refused a job', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return enqueued;
      }
      if (this.redisDown) {
        this.redisDown = false;
        log('DANFSe queue is back, the sweep resumed');
      }
      // False means the invoice changed after the read; the next sweep handles it.
      if (repo.markEnqueued(row.id, mark, now, row.pendingSince)) enqueued += 1;
    }
    return enqueued;
  }

  events(): DanfseQueueEvents {
    const { repo, metrics, log } = this.deps;
    // The job metrics count jobs, not rows: a stale result still counts.
    return {
      completed: (id, result) => {
        const parsed = parseJobId(id);
        if (!parsed) return;
        try {
          repo.markRendered(parsed.invoiceId, parsed.mark, this.now());
          metrics.job('completed');
          metrics.render(result.renderMs / 1000);
        } catch (error) {
          log('DANFSe result not recorded', { jobId: id, error: String(error) });
        }
      },
      failed: (id, reason) => {
        const parsed = parseJobId(id);
        if (!parsed) return;
        try {
          repo.markFailed(parsed.invoiceId, parsed.mark);
          metrics.job('failed');
          log('DANFSe render failed', { jobId: id, reason });
        } catch (error) {
          log('DANFSe failure not recorded', { jobId: id, error: String(error) });
        }
      },
    };
  }

  // The next sweep adds the job with the current XML; add replaces a failed job of the same id.
  async retry(invoiceId: string): Promise<boolean> {
    return this.deps.repo.retry(invoiceId);
  }

  // The sweep takes them 100 per run, so a mass failure does not flood Redis.
  async retryAll(): Promise<number> {
    return this.deps.repo.retryAllFailed();
  }
}
