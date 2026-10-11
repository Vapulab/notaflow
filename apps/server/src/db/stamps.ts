import type { AccountContext, AdminContext } from '@notaflow/core';

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
