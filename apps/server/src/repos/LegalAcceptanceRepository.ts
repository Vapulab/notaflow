import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { legalAcceptances } from '../db/schema';
import { requestContext } from '../requestContext';

// A person's own acceptance, before and outside any account, so it takes the user id, not an account context.
export class LegalAcceptanceRepository {
  constructor(private readonly db: Database) {}

  hasAccepted(userId: string, version: string): boolean {
    return (
      this.db
        .select({ id: legalAcceptances.id })
        .from(legalAcceptances)
        .where(and(eq(legalAcceptances.userId, userId), eq(legalAcceptances.version, version)))
        .get() !== undefined
    );
  }

  // Versions start with their date (YYYY-MM-DD), so a version from that day on sorts at or after it.
  hasAcceptedSince(userId: string, date: string): boolean {
    return (
      this.db
        .select({ id: legalAcceptances.id })
        .from(legalAcceptances)
        .where(and(eq(legalAcceptances.userId, userId), gte(legalAcceptances.version, date)))
        .get() !== undefined
    );
  }

  // True when this call recorded it; false when the user had already accepted this version.
  accept(userId: string, version: string): boolean {
    const request = requestContext.getStore();
    const result = this.db
      .insert(legalAcceptances)
      .values({
        userId,
        version,
        ip: request?.ip ?? null,
        userAgent: request?.userAgent ?? null,
      })
      .onConflictDoNothing()
      .run();
    return result.changes > 0;
  }
}
