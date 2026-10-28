import { r2Client } from '@notaflow/r2';
import { Worker } from 'bullmq';
import { loadWorkerConfig } from './config';
import { clip, processJob } from './process';

const config = loadWorkerConfig(process.env);
const r2 = r2Client(config.r2);

const worker = new Worker('danfse', (job) => processJob(job.data, r2), {
  connection: { url: config.redisUrl, maxRetriesPerRequest: null },
  concurrency: config.concurrency,
});

// Log ids only: the payload holds the customer CPF.
worker.on('failed', (job, err) => {
  console.error(
    `danfse job ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? 0}): ${clip(err.message)}`,
  );
});
worker.on('error', (err) => console.error(`danfse worker error: ${clip(err.message)}`));
console.log('danfse worker started');

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
