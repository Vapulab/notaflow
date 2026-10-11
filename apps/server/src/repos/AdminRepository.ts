import { randomUUID } from 'node:crypto';
import type { AccountRole, AdminContext } from '@notaflow/core';
import { and, count, eq, like, or, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted, removed, touched } from '../db/stamps';
import {
  accounts,
  authAccounts,
  authPasskeys,
  authSessions,
  authVerifications,
  memberships,
  users,
} from '../db/schema';

// Platform scope: every method needs an AdminContext, which only the admin guard builds.
export class AdminRepository {
  constructor(private readonly db: Database) {}

  listAccounts(_ctx: AdminContext) {
    return this.db
      .select({
        id: accounts.id,
        name: accounts.name,
        status: accounts.status,
        plan: accounts.plan,
        members: count(memberships.id),
      })
      .from(accounts)
      .leftJoin(memberships, and(eq(memberships.accountId, accounts.id), notDeleted(memberships)))
      .where(notDeleted(accounts))
      .groupBy(accounts.id)
      .orderBy(accounts.name)
      .all();
  }

  // For the admin's user picker: by name or e-mail, at most 50.
  listUsers(_ctx: AdminContext, search?: string) {
    const pattern = search ? `%${search.toLowerCase()}%` : null;
    return this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        platformRole: users.platformRole,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(
        and(
          notDeleted(users),
          pattern ? or(like(users.email, pattern), like(users.name, pattern)) : undefined,
        ),
      )
      .orderBy(users.name)
      .limit(50)
      .all();
  }

  createAccount(ctx: AdminContext, name: string): string {
    const id = randomUUID();
    this.db
      .insert(accounts)
      .values({ ...created(ctx), id, name })
      .run();
    return id;
  }

  setAccountStatus(ctx: AdminContext, accountId: string, status: 'active' | 'suspended'): boolean {
    return (
      this.db
        .update(accounts)
        .set({ status, ...touched(ctx) })
        .where(and(eq(accounts.id, accountId), notDeleted(accounts)))
        .run().changes > 0
    );
  }

  createUser(ctx: AdminContext, email: string, name: string): string | null {
    const normalized = email.toLowerCase();
    const taken = this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalized), notDeleted(users)))
      .get();
    if (taken) return null;
    const id = randomUUID();
    this.db
      .insert(users)
      .values({ ...created(ctx), id, email: normalized, name })
      .run();
    return id;
  }

  setPlatformRole(ctx: AdminContext, userId: string, platformRole: 'admin' | 'user'): boolean {
    return (
      this.db
        .update(users)
        .set({ platformRole, ...touched(ctx) })
        .where(and(eq(users.id, userId), notDeleted(users)))
        .run().changes > 0
    );
  }

  setMembership(ctx: AdminContext, accountId: string, userId: string, role: AccountRole): boolean {
    const account = this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), notDeleted(accounts)))
      .get();
    const user = this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), notDeleted(users)))
      .get();
    if (!account || !user) return false;
    this.db
      .insert(memberships)
      .values({ ...created(ctx), id: randomUUID(), accountId, userId, role })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.accountId],
        // The unique index counts only active memberships.
        targetWhere: sql`deleted_at IS NULL`,
        set: { role, ...touched(ctx) },
      })
      .run();
    return true;
  }

  // LGPD erasure: the row stays for the records that point at it; the personal data goes.
  anonymizeUser(ctx: AdminContext, userId: string): boolean {
    return this.db.transaction((tx) => {
      const before = tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), notDeleted(users)))
        .get();
      const changed = tx
        .update(users)
        .set({
          name: 'Usuário removido',
          email: `removido-${userId}@anonimo.invalid`,
          image: null,
          ...removed(ctx),
        })
        .where(and(eq(users.id, userId), notDeleted(users)))
        .run().changes;
      if (changed === 0) return false;
      tx.update(memberships)
        .set(removed(ctx))
        .where(and(eq(memberships.userId, userId), notDeleted(memberships)))
        .run();
      // Credentials, not business rows: they hold the e-mail, Google's ID token, and the keys.
      tx.delete(authSessions).where(eq(authSessions.userId, userId)).run();
      tx.delete(authAccounts).where(eq(authAccounts.userId, userId)).run();
      tx.delete(authPasskeys).where(eq(authPasskeys.userId, userId)).run();
      if (before) {
        tx.delete(authVerifications)
          // Exact suffix: LIKE would read an underscore in the e-mail as a wildcard.
          .where(
            sql`substr(${authVerifications.identifier}, -length(${before.email})) = ${before.email}`,
          )
          .run();
      }
      return true;
    });
  }
}
