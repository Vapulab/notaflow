import { asc, desc } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { auditLog } from '../db/schema';
import { requestContext } from '../requestContext';

export interface AuditEntry {
  userEmail: string;
  accountId: string | null;
  action: string;
  entity: string;
  result: 'ok' | 'refused' | 'error';
  detail?: string;
}

// Append-only and written by the platform itself, so it takes no account context.
export class AuditLog {
  constructor(private readonly db: Database) {}

  record(entry: AuditEntry): void {
    const request = requestContext.getStore();
    this.db
      .insert(auditLog)
      .values({
        ...entry,
        detail: entry.detail ?? null,
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
        requestId: request?.requestId ?? null,
      })
      .run();
  }

  list() {
    return this.db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  }

  latest(limit: number) {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all();
  }
}
