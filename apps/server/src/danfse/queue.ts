import type { DanfseMark } from '@notaflow/danfse-pdf';
import { Job, type JobsOptions, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

export interface DanfseJob {
  invoiceId: string;
  accessKey: string;
  mark: DanfseMark;
  xmlGzipBase64: string;
}

export interface FailedJob {
  jobId: string;
  invoiceId: string;
  failedReason: string;
  failedAt: Date;
}

export interface DanfseQueueEvents {
  completed(jobId: string, result: { renderMs: number; bytes: number }): void;
  // Only after the last attempt.
  failed(jobId: string, reason: string): void;
}

export interface DanfseQueue {
  // A job with the same id that waits, runs, or is delayed stays; one in the failed set is replaced by this payload.
  add(job: DanfseJob): Promise<void>;
  failed(limit: number): Promise<FailedJob[]>;
  counts(): Promise<{ failed: number; workers: number }>;
  listen(events: DanfseQueueEvents): void;
  close(): Promise<void>;
}

const QUEUE_NAME = 'danfse';
const MARKS: readonly string[] = ['none', 'cancelada', 'substituida'];

export const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  // The payload holds the customer CPF, so a failed job leaves Redis after 30 days.
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function jobId(invoiceId: string, mark: DanfseMark): string {
  return `${invoiceId}:${mark}`;
}

export function parseJobId(id: string): { invoiceId: string; mark: DanfseMark } | null {
  const cut = id.lastIndexOf(':');
  if (cut <= 0) return null;
  const mark = id.slice(cut + 1);
  if (!MARKS.includes(mark)) return null;
  return { invoiceId: id.slice(0, cut), mark: mark as DanfseMark };
}

// BullMQ refuses a colon in a custom job id; no mark contains an underscore.
const toBullId = (id: string): string => id.replace(/:([^:]*)$/, '_$1');
const fromBullId = (id: string): string => id.replace(/_([^_]*)$/, ':$1');

export function bullmqQueue(redisUrl: string): DanfseQueue {
  // No offline queue on the producer: add rejects at once when Redis is down, so a request never hangs.
  const producer = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: null });
  // QueueEvents blocks on a stream read, so it needs its own connection.
  const consumer = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: producer });
  const events = new QueueEvents(QUEUE_NAME, { connection: consumer });
  // An unhandled 'error' event would crash the process while Redis is down.
  const ignore = () => undefined;
  producer.on('error', ignore);
  consumer.on('error', ignore);
  queue.on('error', ignore);
  events.on('error', ignore);

  // BullMQ waits for a first connection and never rejects on ECONNREFUSED; fail at once instead.
  const ensureReady = () => {
    if (producer.status !== 'ready') throw new Error('Redis is not connected');
  };

  return {
    async add(job) {
      ensureReady();
      const id = toBullId(jobId(job.invoiceId, job.mark));
      // A failed job keeps its id for 30 days and would swallow the add, so drop it first.
      const old = await Job.fromId(queue, id);
      if (old && (await old.getState()) === 'failed') {
        // The job may vanish between the calls; the add below is still right then.
        await old.remove().catch(() => undefined);
      }
      await queue.add('render', job, { ...JOB_OPTIONS, jobId: id });
    },
    async failed(limit) {
      ensureReady();
      const jobs = await queue.getFailed(0, Math.max(limit, 1) - 1);
      return jobs.flatMap((j) => {
        const id = j.id ? fromBullId(j.id) : null;
        const parsed = id ? parseJobId(id) : null;
        if (!id || !parsed) return [];
        return [
          {
            jobId: id,
            invoiceId: parsed.invoiceId,
            failedReason: j.failedReason,
            failedAt: new Date(j.finishedOn ?? 0),
          },
        ];
      });
    },
    async counts() {
      ensureReady();
      const [failed, workers] = await Promise.all([
        queue.getFailedCount(),
        queue.getWorkersCount(),
      ]);
      return { failed, workers };
    },
    listen(handlers) {
      events.on('completed', ({ jobId: id, returnvalue }) => {
        handlers.completed(fromBullId(id), parseResult(returnvalue));
      });
      // 'failed' fires on every attempt, so look at the attempts left before reporting.
      events.on('failed', ({ jobId: id, failedReason }) => {
        void Job.fromId(queue, id)
          .then(async (j) => {
            const state = j ? await j.getState() : 'missing';
            if (isFinalFailure(state, j?.attemptsMade ?? 0, j?.opts.attempts ?? 1)) {
              handlers.failed(fromBullId(id), failedReason);
            }
          })
          .catch(() => undefined);
      });
    },
    async close() {
      // Drop the sockets first: a graceful close waits forever on a Redis that is down.
      producer.disconnect();
      consumer.disconnect();
      const closed = Promise.allSettled([events.close(), queue.close()]);
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000).unref())]);
    },
  };
}

// A job moved to failed early (an unrecoverable error) is final too, whatever its attempts count.
export function isFinalFailure(state: string, attemptsMade: number, attempts: number): boolean {
  return state === 'failed' || state === 'missing' || attemptsMade >= attempts;
}

function parseResult(value: unknown): { renderMs: number; bytes: number } {
  const raw = typeof value === 'string' ? safeJson(value) : value;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    renderMs: typeof r.renderMs === 'number' ? r.renderMs : 0,
    bytes: typeof r.bytes === 'number' ? r.bytes : 0,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function memoryQueue(): DanfseQueue & {
  jobs: DanfseJob[];
  complete(id: string): void;
  fail(id: string, reason: string): void;
} {
  const jobs: DanfseJob[] = [];
  const failedJobs = new Map<string, FailedJob>();
  const listeners: DanfseQueueEvents[] = [];
  const removeJob = (id: string): DanfseJob | undefined => {
    const at = jobs.findIndex((j) => jobId(j.invoiceId, j.mark) === id);
    return at < 0 ? undefined : jobs.splice(at, 1)[0];
  };
  const has = (id: string) => jobs.some((j) => jobId(j.invoiceId, j.mark) === id);
  return {
    jobs,
    async add(job) {
      const id = jobId(job.invoiceId, job.mark);
      if (has(id)) return;
      // Like BullMQ: a failed job with the same id is replaced by the new payload.
      failedJobs.delete(id);
      jobs.push(job);
    },
    async failed(limit) {
      return [...failedJobs.values()].slice(0, limit);
    },
    async counts() {
      return { failed: failedJobs.size, workers: 0 };
    },
    listen(events) {
      listeners.push(events);
    },
    async close() {},
    complete(id) {
      // Like removeOnComplete: the job leaves, so the same id can be added again.
      removeJob(id);
      for (const l of listeners) l.completed(id, { renderMs: 0, bytes: 0 });
    },
    fail(id, reason) {
      const parsed = parseJobId(id);
      removeJob(id);
      failedJobs.set(id, {
        jobId: id,
        invoiceId: parsed?.invoiceId ?? id,
        failedReason: reason,
        failedAt: new Date(),
      });
      for (const l of listeners) l.failed(id, reason);
    },
  };
}
