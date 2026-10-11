import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships } from '../db/schema';
import { created, notDeleted, touched } from '../db/stamps';
import type { CnpjDraft, OnboardingStep } from '../onboarding/types';

export class OnboardingRepository {
  constructor(private readonly db: Database) {}

  // Signup has no account yet, so this one write is not account-scoped: it creates the account and its owner.
  createAccount(userId: string, name: string): string {
    const accountId = randomUUID();
    const ctx: AccountContext = { accountId, userId, role: 'owner', accountStatus: 'active' };
    this.db.transaction((tx) => {
      tx.insert(accounts)
        .values({ ...created(ctx), id: accountId, name, onboardingStep: 'card' })
        .run();
      tx.insert(memberships)
        .values({ ...created(ctx), id: randomUUID(), userId, accountId, role: 'owner' })
        .run();
    });
    return accountId;
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

  setDraft(ctx: AccountContext, draft: CnpjDraft | null): void {
    this.db
      .update(accounts)
      .set({ cnpjDraft: draft ? JSON.stringify(draft) : null, ...touched(ctx) })
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
