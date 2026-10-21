import type { AccountContext } from '@notaflow/core';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { bugReportDeliveries } from '../db/schema';
import { HttpError } from '../httpError';
import {
  BugReportRepository,
  type BugReportForDelivery,
  type BugReportInput,
  type BugReportStatus,
} from '../repos/BugReportRepository';
import type { BugChannelClients, DiscordEmbed } from './channels';
import { maskPath, maskPersonalData } from './mask';

type Kind = (typeof bugReportDeliveries.$inferSelect)['kind'];
type Delivery = typeof bugReportDeliveries.$inferSelect;

// Minutes to wait after the 1st, 2nd, 3rd, and 4th failure; the 5th failure is final (as in the mail outbox).
const BACKOFF_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const STUCK_MS = 5 * 60_000;
// Discord and Notion wait this long for the GitHub link; after that they go without it.
const LINK_WAIT_MS = 10 * 60_000;
export const REPORTS_PER_HOUR = 5;
const EXCERPT = 300;

// The deliveries that must finish first, and whether the wait has the LINK_WAIT_MS limit.
const BEFORE: Record<Kind, { kinds: Kind[]; limited: boolean }> = {
  github_issue: { kinds: [], limited: true },
  notion_page: { kinds: ['github_issue'], limited: true },
  discord_report: { kinds: ['github_issue', 'notion_page'], limited: true },
  notion_status: { kinds: ['notion_page'], limited: false },
  discord_status: { kinds: [], limited: true },
};

export interface BugChannelsOn {
  github: boolean;
  discord: boolean;
  notion: boolean;
}

// Stores a report, then sends it to GitHub, Notion, and Discord with retries, like the mail outbox.
export class BugReports {
  private readonly repo: BugReportRepository;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly deps: {
      db: Database;
      clients: BugChannelClients;
      on: BugChannelsOn;
      appOrigin: string;
      logError: (line: string) => void;
    },
  ) {
    this.repo = new BugReportRepository(deps.db);
  }

  report(ctx: AccountContext, input: BugReportInput, now = new Date()): string {
    const since = new Date(now.getTime() - 3600_000);
    if (this.repo.countByUserSince(ctx, since) >= REPORTS_PER_HOUR) {
      throw new HttpError(429, 'too_many_bug_reports');
    }
    const { on } = this.deps;
    const kinds: Kind[] = [
      ...(on.github ? (['github_issue'] as const) : []),
      ...(on.notion ? (['notion_page'] as const) : []),
      ...(on.discord ? (['discord_report'] as const) : []),
    ];
    const id = this.deps.db.transaction(() => {
      const reportId = this.repo.create(ctx, input);
      this.queue(reportId, kinds, null, now);
      return reportId;
    });
    this.start(id, now);
    return id;
  }

  // The GitHub webhook: a closed issue resolves its report, a reopened one opens it again.
  issueChanged(
    issueNumber: number,
    status: BugReportStatus,
    now = new Date(),
  ): { id: string; accountId: string } | null {
    const report = this.repo.byIssueNumber(issueNumber);
    // GitHub sends again on a timeout: the same status twice changes nothing.
    if (!report || report.status === status) return null;
    const { on } = this.deps;
    const kinds: Kind[] = [
      ...(on.notion ? (['notion_status'] as const) : []),
      ...(on.discord ? (['discord_status'] as const) : []),
    ];
    this.deps.db.transaction(() => {
      this.repo.setStatus(report.id, status, now);
      this.queue(report.id, kinds, status, now);
    });
    this.start(report.id, now);
    return { id: report.id, accountId: report.accountId };
  }

  async deliverDue(now = new Date(), reportId?: string): Promise<void> {
    const t = bugReportDeliveries;
    // A send never takes 5 minutes: a row still sending is from a process that stopped mid-send.
    this.deps.db
      .update(t)
      .set({ status: 'pending' })
      .where(and(eq(t.status, 'sending'), lte(t.nextAttemptAt, new Date(now.getTime() - STUCK_MS))))
      .run();
    const due = this.deps.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.status, 'pending'),
          lte(t.nextAttemptAt, now),
          reportId ? eq(t.bugReportId, reportId) : undefined,
        ),
      )
      .orderBy(asc(t.id))
      .all();
    for (const row of due) {
      if (this.waiting(row, now)) continue;
      // Claim it first, so a second worker run skips it.
      const claimed = this.deps.db
        .update(t)
        .set({ status: 'sending', nextAttemptAt: now })
        .where(and(eq(t.id, row.id), eq(t.status, 'pending')))
        .run();
      if (claimed.changes > 0) await this.attempt(row, now);
    }
  }

  // Resolves once the deliveries started by a request are done; the app waits for it on close.
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private queue(reportId: string, kinds: Kind[], status: BugReportStatus | null, now: Date) {
    for (const kind of kinds) {
      this.deps.db
        .insert(bugReportDeliveries)
        .values({
          bugReportId: reportId,
          kind,
          reportStatus: status,
          status: 'pending',
          nextAttemptAt: now,
          createdAt: now,
        })
        .run();
    }
  }

  // The request answers at once; the first attempt runs after it, and the scheduler retries.
  private start(reportId: string, now: Date): void {
    const run = this.deliverDue(now, reportId)
      .catch((error: unknown) =>
        this.deps.logError(`bug report delivery run failed: ${String(error)}`),
      )
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  private waiting(row: Delivery, now: Date): boolean {
    const before = BEFORE[row.kind];
    if (before.kinds.length === 0) return false;
    if (before.limited && now.getTime() - row.createdAt.getTime() >= LINK_WAIT_MS) return false;
    const open = this.deps.db
      .select({ id: bugReportDeliveries.id })
      .from(bugReportDeliveries)
      .where(
        and(
          eq(bugReportDeliveries.bugReportId, row.bugReportId),
          inArray(bugReportDeliveries.kind, before.kinds),
          inArray(bugReportDeliveries.status, ['pending', 'sending']),
        ),
      )
      .get();
    return open !== undefined;
  }

  private async attempt(row: Delivery, now: Date): Promise<void> {
    const t = bugReportDeliveries;
    const attempts = row.attempts + 1;
    try {
      const report = this.repo.forDelivery(row.bugReportId);
      if (!report) throw new Error('the bug report is gone');
      await this.send(row, report);
    } catch (error) {
      const lastError = String(error).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        this.deps.db
          .update(t)
          .set({ status: 'failed', attempts, lastError })
          .where(eq(t.id, row.id))
          .run();
        this.deps.logError(
          `bug report ${row.bugReportId}: ${row.kind} gave up after ${attempts} attempts: ${lastError}`,
        );
        return;
      }
      const wait = BACKOFF_MINUTES[attempts - 1] ?? 0;
      this.deps.db
        .update(t)
        .set({
          status: 'pending',
          attempts,
          lastError,
          nextAttemptAt: new Date(now.getTime() + wait * 60_000),
        })
        .where(eq(t.id, row.id))
        .run();
      return;
    }
    this.deps.db
      .update(t)
      .set({ status: 'sent', attempts, sentAt: now })
      .where(eq(t.id, row.id))
      .run();
  }

  private async send(row: Delivery, report: BugReportForDelivery): Promise<void> {
    const { clients } = this.deps;
    switch (row.kind) {
      case 'github_issue': {
        // A retry after a lost answer would open a second issue; the stored number says it exists.
        if (report.githubIssueNumber !== null) return;
        const issue = await clients.createIssue({
          title: maskPersonalData(report.title),
          body: issueBody(report),
        });
        this.repo.setIssue(report.id, issue);
        return;
      }
      case 'notion_page': {
        if (report.notionPageId !== null) return;
        const page = await clients.createNotionPage({
          title: report.title,
          description: report.description,
          accountName: report.accountName,
          reporterEmail: report.reporterEmail,
          screenUrl: `${this.deps.appOrigin}${report.pagePath}`,
          issueUrl: report.githubIssueUrl,
          reportedAt: report.createdAt,
          reportId: report.id,
        });
        this.repo.setNotionPage(report.id, page);
        return;
      }
      case 'discord_report':
        return clients.postDiscord({
          content: `Novo bug reportado: ${maskPersonalData(report.title)}`,
          embed: reportEmbed(report),
        });
      case 'notion_status':
        if (report.notionPageId === null) throw new Error('the bug report has no Notion page');
        return clients.setNotionStatus(
          report.notionPageId,
          row.reportStatus === 'closed' ? 'Resolvido' : 'Em análise',
        );
      case 'discord_status': {
        const title = maskPersonalData(report.title);
        const issue = report.githubIssueUrl ? ` ${report.githubIssueUrl}` : '';
        return clients.postDiscord({
          content:
            row.reportStatus === 'closed'
              ? `Resolvido: ${title}${issue}`
              : `Reaberto: ${title}${issue}`,
        });
      }
    }
  }
}

// Public repository: no account, person, or e-mail; the description and the path are masked.
export function issueBody(report: Pick<BugReportForDelivery, 'id' | 'description' | 'pagePath'>) {
  return [
    `**Screen:** \`${maskPath(report.pagePath)}\``,
    '',
    '**What happened (as the customer wrote it, personal data masked):**',
    '',
    // A zero-width space after @ stops the customer's text from pinging a GitHub user.
    maskPersonalData(report.description)
      .replaceAll('@', '@​')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    '',
    `NotaFlow report: \`${report.id}\``,
  ].join('\n');
}

function reportEmbed(report: BugReportForDelivery): DiscordEmbed {
  const description = maskPersonalData(report.description);
  const fields = [
    { name: 'Conta', value: report.accountName || '(removida)', inline: true },
    { name: 'Tela', value: maskPath(report.pagePath), inline: true },
    ...(report.githubIssueUrl ? [{ name: 'Issue', value: report.githubIssueUrl }] : []),
    ...(report.notionPageUrl ? [{ name: 'Notion', value: report.notionPageUrl }] : []),
  ];
  return {
    title: maskPersonalData(report.title),
    description:
      description.length > EXCERPT ? `${description.slice(0, EXCERPT - 1)}…` : description,
    ...(report.githubIssueUrl ? { url: report.githubIssueUrl } : {}),
    fields,
  };
}
