import type { AccountContext, AdminContext } from '@notaflow/core';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Database } from './openDatabase';

// null is the system: a write with no person behind it, such as the sync.
export type Actor = AccountContext | AdminContext | null;

// The scheduler builds its context with userId 'system'; the database stores null.
export function actorId(actor: Actor): string | null {
  if (!actor || actor.userId === 'system') return null;
  return actor.userId;
}

export function created(actor: Actor) {
  const now = new Date();
  const by = actorId(actor);
  return { createdAt: now, updatedAt: now, createdBy: by, updatedBy: by };
}

export function touched(actor: Actor) {
  return { updatedAt: new Date(), updatedBy: actorId(actor) };
}

export function removed(actor: Actor) {
  const now = new Date();
  const by = actorId(actor);
  return { deletedAt: now, deletedBy: by, updatedAt: now, updatedBy: by };
}

type Removable = SQLiteTable & { id: SQLiteColumn; deletedAt: SQLiteColumn };

// The filter every repository read uses; pass each joined business table.
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}

// The only way to remove a business row: the database refuses DELETE.
export function softDelete<T extends Removable>(
  db: Database,
  table: T,
  id: string,
  actor: Actor,
): boolean {
  const result = db
    .update(table)
    .set(removed(actor) as T['$inferInsert'])
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .run();
  return result.changes > 0;
}
