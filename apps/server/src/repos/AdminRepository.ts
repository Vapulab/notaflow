import { randomUUID } from 'node:crypto';
import type { AccountRole, AdminContext } from '@notaflow/core';
import { count, eq, like, or, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, touched } from '../db/stamps';
import { accounts, memberships, users } from '../db/schema';

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
      .leftJoin(memberships, eq(memberships.accountId, accounts.id))
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
      .where(pattern ? or(like(users.email, pattern), like(users.name, pattern)) : undefined)
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
        .where(eq(accounts.id, accountId))
        .run().changes > 0
    );
  }

  createUser(ctx: AdminContext, email: string, name: string): string | null {
    const normalized = email.toLowerCase();
    if (this.db.select().from(users).where(eq(users.email, normalized)).get()) return null;
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
        .where(eq(users.id, userId))
        .run().changes > 0
    );
  }

  setMembership(ctx: AdminContext, accountId: string, userId: string, role: AccountRole): boolean {
    const account = this.db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
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
}
