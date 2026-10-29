import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { mailSuppressions } from '../db/schema';
import { type Actor, created, notDeleted, softDelete, touched } from '../db/stamps';

type Kind = 'invoice';
export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint';

// System table: the address belongs to a third party, not to an account, so there is no account context.
export class MailSuppressionRepository {
  constructor(private readonly db: Database) {}

  private active(address: string, kind: Kind) {
    return this.db
      .select({ id: mailSuppressions.id, reason: mailSuppressions.reason })
      .from(mailSuppressions)
      .where(
        and(
          eq(mailSuppressions.address, address.trim().toLowerCase()),
          eq(mailSuppressions.kind, kind),
          notDeleted(mailSuppressions),
        ),
      )
      .get();
  }

  isSuppressed(address: string, kind: Kind): boolean {
    return !!this.active(address, kind);
  }

  reasonOf(address: string, kind: Kind): SuppressionReason | null {
    return this.active(address, kind)?.reason ?? null;
  }

  // An active row keeps its reason; a complaint is the only one that overrides (it can never be unblocked).
  add(address: string, kind: Kind, reason: SuppressionReason = 'unsubscribe'): void {
    const existing = this.active(address, kind);
    if (existing) {
      if (reason === 'complaint' && existing.reason === 'bounce') {
        this.db
          .update(mailSuppressions)
          .set({ reason, ...touched(null) })
          .where(eq(mailSuppressions.id, existing.id))
          .run();
      }
      return;
    }
    this.db
      .insert(mailSuppressions)
      .values({
        id: randomUUID(),
        address: address.trim().toLowerCase(),
        kind,
        reason,
        ...created(null),
      })
      .run();
  }

  unblockedRecently(address: string, kind: Kind, since: Date): boolean {
    return !!this.db
      .select({ id: mailSuppressions.id })
      .from(mailSuppressions)
      .where(
        and(
          eq(mailSuppressions.address, address.trim().toLowerCase()),
          eq(mailSuppressions.kind, kind),
          eq(mailSuppressions.reason, 'bounce'),
          isNotNull(mailSuppressions.deletedAt),
          gte(mailSuppressions.deletedAt, since),
        ),
      )
      .get();
  }

  unblock(address: string, kind: Kind, actor: Actor): boolean {
    const row = this.active(address, kind);
    if (!row || row.reason !== 'bounce') return false;
    return softDelete(this.db, mailSuppressions, row.id, actor);
  }
}
