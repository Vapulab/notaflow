import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, count, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { certificates, emitters, mailOutbox } from '../db/schema';
import { notDeleted } from '../db/stamps';
import type { MetricSources } from '../metrics/metrics';

// Platform scope: the metrics describe the whole service, so they read across accounts, never a name or document.
export class MetricsRepository implements MetricSources {
  constructor(
    private readonly db: Database,
    private readonly databasePath: string,
  ) {}

  outboxCounts() {
    return this.db
      .select({ status: mailOutbox.status, count: count() })
      .from(mailOutbox)
      .groupBy(mailOutbox.status)
      .all();
  }

  certificateExpiries() {
    return this.db
      .select({ emitterId: certificates.emitterId, validTo: certificates.validTo })
      .from(certificates)
      .innerJoin(emitters, eq(emitters.id, certificates.emitterId))
      .where(and(eq(certificates.active, true), notDeleted(certificates), notDeleted(emitters)))
      .all();
  }

  // backup.ts writes notaflow-*.db next to the database, in backups/.
  latestLocalBackup(): Date | null {
    if (this.databasePath === ':memory:') return null;
    const dir = join(dirname(this.databasePath), 'backups');
    if (!existsSync(dir)) return null;
    const times = readdirSync(dir)
      .filter((name) => /^notaflow-.*\.db$/.test(name))
      .map((name) => statSync(join(dir, name)).mtimeMs);
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }
}
