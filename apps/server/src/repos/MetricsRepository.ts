import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, count, eq, gt, inArray, isNotNull, or } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import {
  accounts,
  bugReportDeliveries,
  bugReportImages,
  bugReports,
  certificates,
  emitters,
  invoices,
  lifecycleEmails,
  mailOutbox,
  users,
} from '../db/schema';
import { notDeleted } from '../db/stamps';
import { DanfseRepository } from './DanfseRepository';
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

  danfsePendingOldest(): Date | null {
    return new DanfseRepository(this.db).oldestPendingAt();
  }

  danfseFailedCount(): number {
    return new DanfseRepository(this.db).failedCount();
  }

  accountCounts() {
    return this.db
      .select({ status: accounts.status, count: count() })
      .from(accounts)
      .where(notDeleted(accounts))
      .groupBy(accounts.status)
      .all();
  }

  userCount(): number {
    return (
      this.db.select({ count: count() }).from(users).where(notDeleted(users)).get()?.count ?? 0
    );
  }

  emitterCounts() {
    return this.db
      .select({ environment: emitters.environment, count: count() })
      .from(emitters)
      .where(notDeleted(emitters))
      .groupBy(emitters.environment)
      .all();
  }

  invoiceCounts() {
    return this.db
      .select({
        origin: invoices.origin,
        status: invoices.status,
        environment: invoices.environment,
        count: count(),
      })
      .from(invoices)
      .where(notDeleted(invoices))
      .groupBy(invoices.origin, invoices.status, invoices.environment)
      .all();
  }

  lifecycleCounts() {
    return this.db
      .select({ phase: lifecycleEmails.phase, step: lifecycleEmails.step, count: count() })
      .from(lifecycleEmails)
      .groupBy(lifecycleEmails.phase, lifecycleEmails.step)
      .all();
  }

  bugReportCounts() {
    return this.db
      .select({ status: bugReports.status, count: count() })
      .from(bugReports)
      .where(notDeleted(bugReports))
      .groupBy(bugReports.status)
      .all();
  }

  bugImageCounts() {
    const rows = this.db
      .select({ purged: isNotNull(bugReportImages.purgedAt), count: count() })
      .from(bugReportImages)
      .where(notDeleted(bugReportImages))
      .groupBy(isNotNull(bugReportImages.purgedAt))
      .all();
    return rows.map((row) => ({ state: row.purged ? 'purged' : 'stored', count: row.count }));
  }

  // A delivery being sent right now still counts as pending; the channel is the first word of the kind.
  // A failed delivery counts for 7 days: there is no retry action, so the alert clears by itself.
  bugDeliveryCounts(now = new Date()) {
    const since = new Date(now.getTime() - 7 * 86400_000);
    const rows = this.db
      .select({
        kind: bugReportDeliveries.kind,
        status: bugReportDeliveries.status,
        count: count(),
      })
      .from(bugReportDeliveries)
      .where(
        or(
          inArray(bugReportDeliveries.status, ['pending', 'sending']),
          and(eq(bugReportDeliveries.status, 'failed'), gt(bugReportDeliveries.createdAt, since)),
        ),
      )
      .groupBy(bugReportDeliveries.kind, bugReportDeliveries.status)
      .all();
    const totals = new Map<string, { channel: string; state: string; count: number }>();
    for (const row of rows) {
      const channel = row.kind.split('_')[0] ?? row.kind;
      const state = row.status === 'failed' ? 'failed' : 'pending';
      const key = `${channel}/${state}`;
      const total = totals.get(key) ?? { channel, state, count: 0 };
      total.count += row.count;
      totals.set(key, total);
    }
    return [...totals.values()];
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
