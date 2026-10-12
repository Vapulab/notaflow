import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/openDatabase';
import { startMetricsServer } from './metrics/server';
import { SyncTargetRepository } from './repos/SyncTargetRepository';
import { runAllOnce, startScheduler } from './sync/scheduler';

const SYNC_INTERVAL_MS = 30 * 60_000;
const MAIL_INTERVAL_MS = 30_000;

try {
  const config = loadConfig(process.env);
  const { db } = openDatabase(config.databasePath);
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const app = buildApp({
    config,
    db,
    ...(existsSync(join(webRoot, 'index.html')) ? { webRoot } : {}),
  });
  await app.listen({ host: config.host, port: config.port });
  if (config.metricsPort) {
    await startMetricsServer(app.metrics, { host: config.host, port: config.metricsPort });
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
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
