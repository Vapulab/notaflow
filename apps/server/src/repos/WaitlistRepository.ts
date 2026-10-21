import { randomUUID } from 'node:crypto';
import type { AdminContext } from '@notaflow/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { waitlistSignups } from '../db/schema';
import { created, notDeleted, softDelete, touched } from '../db/stamps';

export type WaitlistInterest = 'mei' | 'lucro_presumido' | 'certificate';

const INTERESTS: WaitlistInterest[] = ['mei', 'lucro_presumido', 'certificate'];

function parseInterests(json: string): WaitlistInterest[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed)
    ? parsed.filter((i): i is WaitlistInterest => INTERESTS.includes(i))
    : [];
}

// The notify-me list: the public signs up (no context, actor null); only an admin reads or removes.
export class WaitlistRepository {
  constructor(private readonly db: Database) {}

  signUp(input: {
    email: string;
    interests: WaitlistInterest[];
    sourcePage: string;
    campaign: string | null;
  }): void {
    const email = input.email.trim().toLowerCase();
    this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(waitlistSignups)
        .where(and(eq(waitlistSignups.email, email), notDeleted(waitlistSignups)))
        .get();
      if (!existing) {
        tx.insert(waitlistSignups)
          .values({
            ...created(null),
            id: randomUUID(),
            email,
            interests: JSON.stringify([...new Set(input.interests)]),
            sourcePage: input.sourcePage,
            campaign: input.campaign,
          })
          .run();
        return;
      }
      const merged = [...new Set([...parseInterests(existing.interests), ...input.interests])];
      tx.update(waitlistSignups)
        .set({ interests: JSON.stringify(merged), ...touched(null) })
        .where(eq(waitlistSignups.id, existing.id))
        .run();
    });
  }

  list(_ctx: AdminContext) {
    return this.db
      .select()
      .from(waitlistSignups)
      .where(notDeleted(waitlistSignups))
      .orderBy(desc(waitlistSignups.createdAt))
      .all()
      .map((r) => ({
        id: r.id,
        email: r.email,
        interests: parseInterests(r.interests),
        sourcePage: r.sourcePage,
        createdAt: r.createdAt,
      }));
  }

  counts(ctx: AdminContext): Record<WaitlistInterest, number> {
    const totals: Record<WaitlistInterest, number> = { mei: 0, lucro_presumido: 0, certificate: 0 };
    for (const row of this.list(ctx)) for (const i of row.interests) totals[i] += 1;
    return totals;
  }

  remove(ctx: AdminContext, id: string): boolean {
    return softDelete(this.db, waitlistSignups, id, ctx);
  }
}
