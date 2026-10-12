import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { policyNoticeViews } from '../db/schema';

// A person's own record, outside any account, like the legal acceptance.
export class PolicyNoticeRepository {
  constructor(private readonly db: Database) {}

  hasSeen(userId: string, noticeId: string): boolean {
    return (
      this.db
        .select({ id: policyNoticeViews.id })
        .from(policyNoticeViews)
        .where(and(eq(policyNoticeViews.userId, userId), eq(policyNoticeViews.noticeId, noticeId)))
        .get() !== undefined
    );
  }

  // True when this call recorded it; false when it was already seen.
  see(userId: string, noticeId: string, now = new Date()): boolean {
    return (
      this.db
        .insert(policyNoticeViews)
        .values({ userId, noticeId, seenAt: now })
        .onConflictDoNothing()
        .run().changes > 0
    );
  }
}
