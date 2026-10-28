import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { describe, expect, test, vi } from 'vitest';
import {
  bullmqQueue,
  type DanfseJob,
  isFinalFailure,
  jobId,
  memoryQueue,
  parseJobId,
} from './queue';

const job = (invoiceId = 'inv1', mark: DanfseJob['mark'] = 'none'): DanfseJob => ({
  invoiceId,
  accessKey: 'K'.repeat(50),
  mark,
  xmlGzipBase64: 'H4sI',
});

test('jobId and parseJobId round-trip every mark', () => {
  for (const mark of ['none', 'cancelada', 'substituida'] as const) {
    expect(parseJobId(jobId('inv-1', mark))).toEqual({ invoiceId: 'inv-1', mark });
  }
  expect(jobId('inv-1', 'cancelada')).toBe('inv-1:cancelada');
  expect(parseJobId('inv-1:bogus')).toBeNull();
  expect(parseJobId('nomark')).toBeNull();
});

describe('memoryQueue', () => {
  test('ignores a duplicate job id', async () => {
    const q = memoryQueue();
    await q.add(job());
    await q.add(job());
    await q.add(job('inv1', 'cancelada'));
    expect(q.jobs.map((j) => jobId(j.invoiceId, j.mark))).toEqual(['inv1:none', 'inv1:cancelada']);
  });

  test('calls completed and failed only through complete and fail', async () => {
    const q = memoryQueue();
    const events = { completed: vi.fn(), failed: vi.fn() };
    q.listen(events);
    await q.add(job());
    expect(events.failed).not.toHaveBeenCalled();
    q.fail('inv1:none', 'boom');
    expect(events.failed).toHaveBeenCalledWith('inv1:none', 'boom');
    expect(await q.failed(10)).toMatchObject([
      { jobId: 'inv1:none', invoiceId: 'inv1', failedReason: 'boom' },
    ]);
    expect(await q.counts()).toEqual({ failed: 1, workers: 0 });
    q.complete('inv1:none');
    expect(events.completed).toHaveBeenCalledWith('inv1:none', { renderMs: 0, bytes: 0 });
  });
});

test('isFinalFailure reports an early failed state and the last attempt, not a retry', () => {
  expect(isFinalFailure('failed', 1, 5)).toBe(true);
  expect(isFinalFailure('missing', 0, 1)).toBe(true);
  expect(isFinalFailure('active', 5, 5)).toBe(true);
  expect(isFinalFailure('delayed', 1, 5)).toBe(false);
  expect(isFinalFailure('waiting', 4, 5)).toBe(false);
});

describe('memoryQueue lifecycle', () => {
  test('complete removes the job so the same id can be added again', async () => {
    const q = memoryQueue();
    await q.add(job());
    q.complete('inv1:none');
    expect(q.jobs).toEqual([]);
    await q.add(job());
    expect(q.jobs).toHaveLength(1);
  });

  test('adding a failed id replaces it with the new payload', async () => {
    const q = memoryQueue();
    await q.add(job());
    q.fail('inv1:none', 'boom');
    expect(q.jobs).toEqual([]);
    const fresh = { ...job(), xmlGzipBase64: 'NEW' };
    await q.add(fresh);
    expect(q.jobs).toEqual([fresh]);
    expect(await q.counts()).toEqual({ failed: 0, workers: 0 });
  });

  test('adding a waiting id keeps the first payload', async () => {
    const q = memoryQueue();
    await q.add(job());
    await q.add({ ...job(), xmlGzipBase64: 'NEW' });
    expect(q.jobs).toEqual([job()]);
  });
});

describe.runIf(process.env.TEST_REDIS_URL)('bullmqQueue on a real Redis', () => {
  test('adds once, lists, counts, and closes', async () => {
    const q = bullmqQueue(process.env.TEST_REDIS_URL ?? '');
    const id = `t${Date.now()}`;
    try {
      // The first connection takes a moment; add refuses until then.
      await vi.waitFor(() => q.add(job(id)), { timeout: 3000 });
      await q.add(job(id));
      expect(await q.counts()).toMatchObject({ workers: 0 });
      expect(await q.failed(10)).toEqual(expect.any(Array));
    } finally {
      await q.close();
    }
  });

  test('adding a failed id replaces the failed job with the new payload', async () => {
    const url = process.env.TEST_REDIS_URL ?? '';
    const q = bullmqQueue(url);
    const id = `f${Date.now()}`;
    const worker = new Worker(
      'danfse',
      async () => {
        throw new UnrecoverableError('boom');
      },
      { connection: new Redis(url, { maxRetriesPerRequest: null }) },
    );
    try {
      await vi.waitFor(() => q.add(job(id)), { timeout: 3000 });
      await vi.waitFor(
        async () => expect((await q.failed(100)).map((f) => f.invoiceId)).toContain(id),
        {
          timeout: 5000,
        },
      );
      await worker.close();
      await q.add({ ...job(id), xmlGzipBase64: 'NEW' });
      expect((await q.failed(100)).map((f) => f.invoiceId)).not.toContain(id);
      const probe = new Queue('danfse', {
        connection: new Redis(url, { maxRetriesPerRequest: null }),
      });
      const fresh = await Job.fromId(probe, `${id}_none`);
      expect(fresh?.data.xmlGzipBase64).toBe('NEW');
      await fresh?.remove();
      await probe.close();
    } finally {
      await worker.close();
      await q.close();
    }
  });

  test('every call rejects fast when Redis is down', async () => {
    const q = bullmqQueue('redis://127.0.0.1:1');
    try {
      await expect(q.add(job())).rejects.toThrow();
      await expect(q.counts()).rejects.toThrow();
      await expect(q.failed(5)).rejects.toThrow();
    } finally {
      await q.close();
    }
  });
});
