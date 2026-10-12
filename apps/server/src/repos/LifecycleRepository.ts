import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { lifecycleEmails } from '../db/schema';
import type { Candidate, Phase, Variant } from '../lifecycle/schedule';
import type { MailMessage } from '../mail/mailer';
import type { MailOutbox } from '../mail/outbox';

export interface CandidateRow extends Candidate {
  accountId: string;
  userId: string;
  email: string;
  name: string;
}

interface RawRow {
  accountId: string;
  userId: string;
  email: string;
  name: string;
  step: Candidate['onboardingStep'];
  createdAt: number;
  doneAt: number | null;
  lastIssue: number | null;
}

// Platform scope, like MetricsRepository: it reads across accounts, and returns only ids, the step, and dates.
export class LifecycleRepository {
  constructor(
    private readonly db: Database,
    private readonly legalVersion: string,
  ) {}

  candidates(): CandidateRow[] {
    const rows = this.db.$client
      .prepare(
        `SELECT a.id AS accountId, u.id AS userId, u.email, u.name, a.onboarding_step AS step,
                a.created_at AS createdAt, a.onboarding_done_at AS doneAt,
                (SELECT max(i.issued_at) FROM invoices i JOIN emitters e ON e.id = i.emitter_id
                  WHERE e.account_id = a.id AND i.origin = 'app' AND i.environment = 'producao'
                    AND i.issued_at IS NOT NULL AND i.deleted_at IS NULL) AS lastIssue
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           JOIN accounts a ON a.id = m.account_id
          WHERE m.role = 'owner' AND m.deleted_at IS NULL AND u.deleted_at IS NULL
            AND a.deleted_at IS NULL AND a.status = 'active' AND u.lifecycle_opt_out_at IS NULL
            AND EXISTS (SELECT 1 FROM legal_acceptances l WHERE l.user_id = u.id AND l.version >= ?)
          ORDER BY a.created_at, a.id`,
      )
      .all(this.legalVersion) as RawRow[];
    return rows.map((r) => ({
      accountId: r.accountId,
      userId: r.userId,
      email: r.email,
      name: r.name,
      onboardingStep: r.step,
      accountCreatedAt: new Date(r.createdAt),
      onboardingDoneAt: r.doneAt === null ? null : new Date(r.doneAt),
      lastProductionIssueAt: r.lastIssue === null ? null : new Date(r.lastIssue),
    }));
  }

  sentSince(userId: string, since: Date): boolean {
    return (
      this.db
        .select({ id: lifecycleEmails.id })
        .from(lifecycleEmails)
        .where(and(eq(lifecycleEmails.userId, userId), gte(lifecycleEmails.sentAt, since)))
        .get() !== undefined
    );
  }

  // The record and the outbox row in one transaction; false when this e-mail was already sent.
  recordAndQueue(
    send: {
      userId: string;
      accountId: string;
      phase: Phase;
      step: 1 | 2;
      variant: Variant;
      anchorAt: Date;
    },
    message: MailMessage,
    outbox: MailOutbox,
    now: Date,
  ): boolean {
    return this.db.transaction((tx) => {
      const recorded = tx
        .insert(lifecycleEmails)
        .values({ ...send, sentAt: now })
        .onConflictDoNothing()
        .run();
      if (recorded.changes === 0) return false;
      outbox.queue(message, 'lifecycle', now, tx);
      return true;
    });
  }
}
