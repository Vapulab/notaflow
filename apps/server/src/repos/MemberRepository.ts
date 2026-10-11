import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted } from '../db/stamps';
import { memberships, users } from '../db/schema';

export class MemberRepository {
  constructor(private readonly db: Database) {}

  list(ctx: AccountContext) {
    return this.db
      .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(eq(memberships.accountId, ctx.accountId), notDeleted(memberships), notDeleted(users)),
      )
      .orderBy(users.email)
      .all();
  }

  invite(
    ctx: AccountContext,
    email: string,
    name: string,
  ): { userId: string; created: boolean } | null {
    const normalized = email.toLowerCase();
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(users)
        .where(and(eq(users.email, normalized), notDeleted(users)))
        .get();
      const userId = existing?.id ?? randomUUID();
      if (!existing) {
        tx.insert(users)
          .values({ ...created(ctx), id: userId, email: normalized, name })
          .run();
      }
      const member = tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.accountId, ctx.accountId),
            eq(memberships.userId, userId),
            notDeleted(memberships),
          ),
        )
        .get();
      if (member) return null;
      tx.insert(memberships)
        .values({
          ...created(ctx),
          id: randomUUID(),
          accountId: ctx.accountId,
          userId,
          role: 'member',
        })
        .run();
      return { userId, created: !existing };
    });
  }
}
