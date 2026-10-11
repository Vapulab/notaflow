import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { notDeleted } from '../db/stamps';
import { accounts, emitters } from '../db/schema';

// Platform scope: the scheduler runs for every account, before any account context exists.
export class SyncTargetRepository {
  constructor(private readonly db: Database) {}

  list() {
    return this.db
      .select({ accountId: accounts.id, accountStatus: accounts.status, emitterId: emitters.id })
      .from(emitters)
      .innerJoin(accounts, eq(accounts.id, emitters.accountId))
      .where(and(notDeleted(emitters), notDeleted(accounts)))
      .all();
  }
}
