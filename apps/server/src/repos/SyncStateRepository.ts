import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted, touched } from '../db/stamps';
import { emitters, syncState } from '../db/schema';

export type SyncStateRow = Pick<
  typeof syncState.$inferSelect,
  'emitterId' | 'environment' | 'lastNsu' | 'lastRunAt' | 'lastSuccessAt' | 'lastError'
>;

const CURSOR = {
  emitterId: syncState.emitterId,
  environment: syncState.environment,
  lastNsu: syncState.lastNsu,
  lastRunAt: syncState.lastRunAt,
  lastSuccessAt: syncState.lastSuccessAt,
  lastError: syncState.lastError,
};

export class SyncStateRepository {
  constructor(private readonly db: Database) {}

  get(ctx: AccountContext, emitterId: string, environment: Environment): SyncStateRow {
    const row = this.db
      .select({ state: CURSOR })
      .from(syncState)
      .innerJoin(emitters, eq(emitters.id, syncState.emitterId))
      .where(
        and(
          eq(syncState.emitterId, emitterId),
          eq(syncState.environment, environment),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
        ),
      )
      .get();
    return (
      row?.state ?? {
        emitterId,
        environment,
        lastNsu: 0,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
      }
    );
  }

  saveCursor(ctx: AccountContext, emitterId: string, environment: Environment, lastNsu: number) {
    this.upsert(ctx, emitterId, environment, { lastNsu });
  }

  recordRun(
    ctx: AccountContext,
    emitterId: string,
    environment: Environment,
    result: { at: Date; error: string | null },
  ): void {
    this.upsert(ctx, emitterId, environment, {
      lastRunAt: result.at,
      lastError: result.error,
      ...(result.error === null ? { lastSuccessAt: result.at } : {}),
    });
  }

  private upsert(
    ctx: AccountContext,
    emitterId: string,
    environment: Environment,
    values: Partial<Omit<SyncStateRow, 'emitterId' | 'environment'>>,
  ): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(
        and(
          eq(emitters.id, emitterId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
        ),
      )
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
    this.db
      .insert(syncState)
      .values({ ...created(ctx), emitterId, environment, ...values })
      .onConflictDoUpdate({
        target: [syncState.emitterId, syncState.environment],
        set: { ...values, ...touched(ctx) },
      })
      .run();
  }
}
