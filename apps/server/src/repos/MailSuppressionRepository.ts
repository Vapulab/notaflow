import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { mailSuppressions } from '../db/schema';
import { created, notDeleted } from '../db/stamps';

type Kind = 'invoice';

// System table: the address belongs to a third party, not to an account, so there is no account context.
export class MailSuppressionRepository {
  constructor(private readonly db: Database) {}

  isSuppressed(address: string, kind: Kind): boolean {
    return !!this.db
      .select({ id: mailSuppressions.id })
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

  add(address: string, kind: Kind): void {
    if (this.isSuppressed(address, kind)) return;
    this.db
      .insert(mailSuppressions)
      .values({ id: randomUUID(), address: address.trim().toLowerCase(), kind, ...created(null) })
      .run();
  }
}
