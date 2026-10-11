import { randomUUID } from 'node:crypto';
import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted, touched } from '../db/stamps';
import { emitters, invoices } from '../db/schema';

export type EmitterRow = typeof emitters.$inferSelect;
export type NewEmitter = Omit<
  typeof emitters.$inferInsert,
  'id' | 'accountId' | 'environment' | 'provider' | 'nextDpsNumber' | 'createdAt'
> & { environment?: Environment };

export interface FiscalConfig {
  simplesAnnex: 'III' | 'V' | null;
  simplesBand: number | null;
  simplesPercent: number | null; // hundredths; the domestic rate
  simplesRbt12Cents: number | null;
  simplesRbt12At: Date | null;
  issRate: number | null; // hundredths
  ibscbsRegime: 'inside_das' | 'regular';
  ibscbsRegimeFrom: string | null; // YYYY-MM-DD
}

export class EmitterRepository {
  constructor(private readonly db: Database) {}

  list(ctx: AccountContext): EmitterRow[] {
    return this.db
      .select()
      .from(emitters)
      .where(and(eq(emitters.accountId, ctx.accountId), notDeleted(emitters)))
      .all();
  }

  get(ctx: AccountContext, emitterId: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(
          and(
            eq(emitters.id, emitterId),
            eq(emitters.accountId, ctx.accountId),
            notDeleted(emitters),
          ),
        )
        .get() ?? null
    );
  }

  findByCnpj(ctx: AccountContext, cnpj: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(
          and(eq(emitters.cnpj, cnpj), eq(emitters.accountId, ctx.accountId), notDeleted(emitters)),
        )
        .get() ?? null
    );
  }

  // Answers only yes or no, so a caller learns nothing else about the other account.
  isCnpjTakenElsewhere(ctx: AccountContext, cnpj: string): boolean {
    return (
      this.db
        .select({ id: emitters.id })
        .from(emitters)
        .where(
          and(eq(emitters.cnpj, cnpj), ne(emitters.accountId, ctx.accountId), notDeleted(emitters)),
        )
        .get() !== undefined
    );
  }

  // Yes or no only, across accounts: its invoices stay under the removed emitter, so the CNPJ waits for a restore.
  isCnpjOfRemovedEmitter(_ctx: AccountContext, cnpj: string): boolean {
    return (
      this.db
        .select({ id: emitters.id })
        .from(emitters)
        .where(and(eq(emitters.cnpj, cnpj), isNotNull(emitters.deletedAt)))
        .get() !== undefined
    );
  }

  create(ctx: AccountContext, input: NewEmitter): EmitterRow {
    return this.db
      .insert(emitters)
      .values({ ...created(ctx), ...input, id: randomUUID(), accountId: ctx.accountId })
      .returning()
      .get();
  }

  reserveDpsNumber(ctx: AccountContext, emitterId: string): number {
    // One UPDATE ... RETURNING: SQLite runs it atomically, so two requests never get one number.
    // Invoices issued before the app used numbers of the same series; a reused number gets E0014.
    const usedAbove = sql`(SELECT coalesce(max(${invoices.dpsNumber}), 0) + 1 FROM ${invoices}
      WHERE ${invoices.emitterId} = ${emitters.id} AND ${invoices.dpsSeries} = ${emitters.dpsSeries})`;
    const row = this.db
      .update(emitters)
      .set({
        nextDpsNumber: sql`max(${emitters.nextDpsNumber}, ${usedAbove}) + 1`,
        ...touched(ctx),
      })
      .where(
        and(
          eq(emitters.id, emitterId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
        ),
      )
      .returning({ next: emitters.nextDpsNumber })
      .get();
    if (!row) throw new Error('Emitter not found in this account.');
    return row.next - 1;
  }

  setEnvironment(ctx: AccountContext, emitterId: string, environment: Environment): boolean {
    return (
      this.db
        .update(emitters)
        .set({ environment, ...touched(ctx) })
        .where(
          and(
            eq(emitters.id, emitterId),
            eq(emitters.accountId, ctx.accountId),
            notDeleted(emitters),
          ),
        )
        .run().changes > 0
    );
  }

  fiscalConfig(ctx: AccountContext, emitterId: string): FiscalConfig | null {
    return (
      this.db
        .select({
          simplesAnnex: emitters.simplesAnnex,
          simplesBand: emitters.simplesBand,
          simplesPercent: emitters.simplesPercent,
          simplesRbt12Cents: emitters.simplesRbt12Cents,
          simplesRbt12At: emitters.simplesRbt12At,
          issRate: emitters.issRate,
          ibscbsRegime: emitters.ibscbsRegime,
          ibscbsRegimeFrom: emitters.ibscbsRegimeFrom,
        })
        .from(emitters)
        .where(
          and(
            eq(emitters.id, emitterId),
            eq(emitters.accountId, ctx.accountId),
            notDeleted(emitters),
          ),
        )
        .get() ?? null
    );
  }

  setFiscalConfig(ctx: AccountContext, emitterId: string, config: FiscalConfig): boolean {
    return (
      this.db
        .update(emitters)
        .set({ ...config, ...touched(ctx) })
        .where(
          and(
            eq(emitters.id, emitterId),
            eq(emitters.accountId, ctx.accountId),
            notDeleted(emitters),
          ),
        )
        .run().changes > 0
    );
  }
}
