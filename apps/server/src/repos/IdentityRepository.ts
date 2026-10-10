import type { AccountRole } from '@notaflow/core';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships, users } from '../db/schema';

export interface Identity {
  userId: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  memberships: {
    accountId: string;
    accountName: string;
    role: AccountRole;
    accountStatus: 'active' | 'suspended';
  }[];
}

// Authentication runs before any account context exists, so this lookup is not account-scoped.
export class IdentityRepository {
  constructor(private readonly db: Database) {}

  findByEmail(email: string): Identity | null {
    const user = this.db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    if (!user) return null;
    const rows = this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        role: memberships.role,
        accountStatus: accounts.status,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(eq(memberships.userId, user.id))
      .all();
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      memberships: rows,
    };
  }

  // Every request calls this; the condition keeps it to one write per user every 15 minutes.
  touchLogin(userId: string, now = new Date()): void {
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    this.db
      .update(users)
      .set({ lastLoginAt: now })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastLoginAt), lt(users.lastLoginAt, staleBefore)),
        ),
      )
      .run();
  }
}
