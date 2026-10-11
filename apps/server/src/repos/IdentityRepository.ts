import type { AccountRole } from '@notaflow/core';
import { and, eq, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { notDeleted } from '../db/stamps';
import type { OnboardingStep } from '../onboarding/types';
import { accounts, emitters, memberships, users } from '../db/schema';

export interface Identity {
  userId: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  tourSeenAt: Date | null;
  memberships: {
    accountId: string;
    accountName: string;
    role: AccountRole;
    accountStatus: 'active' | 'suspended';
    onboardingStep: OnboardingStep;
    // An active emitter of the account has no Simples configuration yet (the tour points to it).
    needsFiscalConfig: boolean;
  }[];
}

// Authentication runs before any account context exists, so this lookup is not account-scoped.
export class IdentityRepository {
  constructor(private readonly db: Database) {}

  findByEmail(email: string): Identity | null {
    return this.identity(eq(users.email, email.toLowerCase()));
  }

  findById(userId: string): Identity | null {
    return this.identity(eq(users.id, userId));
  }

  private identity(match: SQL): Identity | null {
    const user = this.db
      .select()
      .from(users)
      .where(and(match, notDeleted(users)))
      .get();
    if (!user) return null;
    const rows = this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        role: memberships.role,
        accountStatus: accounts.status,
        onboardingStep: accounts.onboardingStep,
        needsFiscalConfig: sql<number>`exists (select 1 from ${emitters} where ${emitters.accountId} = ${accounts.id} and ${emitters.deletedAt} is null and ${emitters.simplesPercent} is null)`,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(and(eq(memberships.userId, user.id), notDeleted(memberships), notDeleted(accounts)))
      .all();
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      tourSeenAt: user.tourSeenAt,
      memberships: rows.map((row) => ({
        ...row,
        needsFiscalConfig: Boolean(row.needsFiscalConfig),
      })),
    };
  }

  markTourSeen(userId: string, now = new Date()): void {
    this.db
      .update(users)
      .set({ tourSeenAt: now, updatedAt: now, updatedBy: userId })
      .where(eq(users.id, userId))
      .run();
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
