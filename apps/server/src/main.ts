import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { bullmqQueue } from './danfse/queue';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/openDatabase';
import { startMetricsServer } from './metrics/server';
import { SyncTargetRepository } from './repos/SyncTargetRepository';
import { runAllOnce, startScheduler } from './sync/scheduler';
import { trustedPeer } from './trustedPeer';

const SYNC_INTERVAL_MS = 30 * 60_000;
const MAIL_INTERVAL_MS = 30_000;
const BUG_INTERVAL_MS = 30_000;
const DANFSE_INTERVAL_MS = 10_000;
const LIFECYCLE_INTERVAL_MS = 15 * 60_000;
// A daily job, checked every hour: a deploy restarts the process, so a 24-hour timer could never fire.
const BUG_IMAGE_PURGE_INTERVAL_MS = 60 * 60_000;

try {
  const config = loadConfig(process.env);
  const { db } = openDatabase(config.databasePath);
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const app = buildApp({
    config,
    db,
    ...(config.danfse ? { danfseQueue: bullmqQueue(config.danfse.redisUrl) } : {}),
    ...(existsSync(join(webRoot, 'index.html')) ? { webRoot } : {}),
  });
  await app.listen({ host: config.host, port: config.port });
  if (config.metricsPort) {
    await startMetricsServer(app.metrics, {
      host: config.host,
      port: config.metricsPort,
      ...(config.metricsAllowHost ? { allow: trustedPeer(config.metricsAllowHost) } : {}),
    });
  }
  const targets = new SyncTargetRepository(db);
  startScheduler(
    () =>
      runAllOnce({
        targets,
        sync: app.syncService,
        log: (message, data) => app.log.info(data, message),
      }),
    SYNC_INTERVAL_MS,
    (error) => app.log.error({ err: error }, 'scheduled sync failed'),
  );
  startScheduler(
    () => app.mailOutbox.deliverDue(),
    MAIL_INTERVAL_MS,
    (error) => app.log.error({ err: error }, 'mail outbox run failed'),
  );
  startScheduler(
    () => app.bugReports.deliverDue(),
    BUG_INTERVAL_MS,
    (error) => app.log.error({ err: error }, 'bug report delivery run failed'),
  );
  startScheduler(
    async () => {
      const purged = await app.bugReports.purgeImages();
      if (purged > 0) app.log.info({ module: 'app', purged }, 'bug report images purged');
    },
    BUG_IMAGE_PURGE_INTERVAL_MS,
    (error) => app.log.error({ err: error }, 'bug report image purge failed'),
  );
  startScheduler(
    async () => {
      const queued = await app.lifecycle.runDue(new Date());
      if (queued > 0) app.log.info({ module: 'mail', queued }, 'lifecycle e-mails queued');
    },
    LIFECYCLE_INTERVAL_MS,
    (error) => app.log.error({ err: error }, 'lifecycle run failed'),
  );
  const danfse = app.danfse;
  if (danfse) {
    startScheduler(
      async () => {
        const queued = await danfse.dispatcher.sweep();
        if (queued > 0) app.log.info({ module: 'danfse', queued }, 'DANFSe renders enqueued');
      },
      DANFSE_INTERVAL_MS,
      (error) => app.log.error({ err: error }, 'DANFSe sweep failed'),
    );
  }
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
