import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships } from '../db/schema';
import { created, notDeleted, touched } from '../db/stamps';
import type { CnpjDraft, OnboardingStep } from '../onboarding/types';

export class OnboardingRepository {
  constructor(private readonly db: Database) {}

  // Signup has no account yet, so this one write is not account-scoped: it creates the account and its owner.
  // Null when the user already belongs to an account, read inside the transaction against a parallel call.
  createAccount(userId: string, name: string): string | null {
    const accountId = randomUUID();
    const ctx: AccountContext = { accountId, userId, role: 'owner', accountStatus: 'active' };
    return this.db.transaction((tx) => {
      const member = tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), notDeleted(memberships)))
        .get();
      if (member) return null;
      tx.insert(accounts)
        .values({ ...created(ctx), id: accountId, name, onboardingStep: 'card' })
        .run();
      tx.insert(memberships)
        .values({ ...created(ctx), id: randomUUID(), userId, accountId, role: 'owner' })
        .run();
      return accountId;
    });
  }

  step(ctx: AccountContext): OnboardingStep | null {
    return (
      this.db
        .select({ step: accounts.onboardingStep })
        .from(accounts)
        .where(and(eq(accounts.id, ctx.accountId), notDeleted(accounts)))
        .get()?.step ?? null
    );
  }

  draft(ctx: AccountContext): CnpjDraft | null {
    const row = this.db
      .select({ draft: accounts.cnpjDraft })
      .from(accounts)
      .where(and(eq(accounts.id, ctx.accountId), notDeleted(accounts)))
      .get();
    return row?.draft ? (JSON.parse(row.draft) as CnpjDraft) : null;
  }

  // The card replaces the previous one, so repeated uploads never pile up.
  setDraft(
    ctx: AccountContext,
    draft: CnpjDraft | null,
    card: { fileName: string; content: Buffer } | null = null,
  ): void {
    this.db
      .update(accounts)
      .set({
        cnpjDraft: draft ? JSON.stringify(draft) : null,
        cnpjDraftCard: card ? gzipSync(card.content) : null,
        cnpjDraftCardName: card?.fileName ?? null,
        ...touched(ctx),
      })
      .where(and(eq(accounts.id, ctx.accountId), notDeleted(accounts)))
      .run();
  }

  draftCard(ctx: AccountContext): { fileName: string; content: Buffer } | null {
    const row = this.db
      .select({ card: accounts.cnpjDraftCard, name: accounts.cnpjDraftCardName })
      .from(accounts)
      .where(and(eq(accounts.id, ctx.accountId), notDeleted(accounts)))
      .get();
    return row?.card && row.name ? { fileName: row.name, content: gunzipSync(row.card) } : null;
  }

  // An account that got an emitter some other way needs no onboarding.
  markDone(ctx: AccountContext): void {
    this.db
      .update(accounts)
      .set({ onboardingStep: 'done', ...touched(ctx) })
      .where(and(eq(accounts.id, ctx.accountId), notDeleted(accounts)))
      .run();
  }

  // Compare and set: a step moves only from the one it expects, so it never runs twice or out of order.
  advance(ctx: AccountContext, from: OnboardingStep, to: OnboardingStep): boolean {
    return (
      this.db
        .update(accounts)
        .set({ onboardingStep: to, ...touched(ctx) })
        .where(
          and(
            eq(accounts.id, ctx.accountId),
            eq(accounts.onboardingStep, from),
            notDeleted(accounts),
          ),
        )
        .run().changes > 0
    );
  }
}
