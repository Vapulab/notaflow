import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, count, eq, gte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, bugReports, users } from '../db/schema';
import { created, notDeleted, touched } from '../db/stamps';

export interface BugReportInput {
  title: string;
  description: string;
  pagePath: string;
  userAgent: string | null;
}

export type BugReportStatus = 'open' | 'closed';

// What a delivery sends: the report with the names that only the private channels may see.
export interface BugReportForDelivery {
  id: string;
  title: string;
  description: string;
  pagePath: string;
  status: BugReportStatus;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  notionPageId: string | null;
  notionPageUrl: string | null;
  createdAt: Date;
  accountName: string;
  reporterEmail: string | null;
}

export class BugReportRepository {
  constructor(private readonly db: Database) {}

  create(ctx: AccountContext, input: BugReportInput): string {
    const id = randomUUID();
    this.db
      .insert(bugReports)
      .values({ ...created(ctx), id, accountId: ctx.accountId, ...input })
      .run();
    return id;
  }

  // The rate limit is per person, so it counts the reports of this user in every account.
  countByUserSince(ctx: AccountContext, since: Date): number {
    return (
      this.db
        .select({ count: count() })
        .from(bugReports)
        .where(
          and(
            eq(bugReports.createdBy, ctx.userId),
            gte(bugReports.createdAt, since),
            notDeleted(bugReports),
          ),
        )
        .get()?.count ?? 0
    );
  }

  // System scope from here on: the delivery worker and the GitHub webhook act for no account.
  forDelivery(id: string): BugReportForDelivery | null {
    const row = this.db
      .select({
        id: bugReports.id,
        title: bugReports.title,
        description: bugReports.description,
        pagePath: bugReports.pagePath,
        status: bugReports.status,
        githubIssueNumber: bugReports.githubIssueNumber,
        githubIssueUrl: bugReports.githubIssueUrl,
        notionPageId: bugReports.notionPageId,
        notionPageUrl: bugReports.notionPageUrl,
        createdAt: bugReports.createdAt,
        accountName: accounts.name,
        reporterEmail: users.email,
      })
      .from(bugReports)
      // A removed account or user still lets the report go out, only without the name.
      .leftJoin(accounts, and(eq(accounts.id, bugReports.accountId), notDeleted(accounts)))
      .leftJoin(users, and(eq(users.id, bugReports.createdBy), notDeleted(users)))
      .where(and(eq(bugReports.id, id), notDeleted(bugReports)))
      .get();
    return row ? { ...row, accountName: row.accountName ?? '' } : null;
  }

  // The issue number is unique in the one repository the reports go to.
  byIssueNumber(
    issueNumber: number,
  ): { id: string; accountId: string; status: BugReportStatus } | null {
    return (
      this.db
        .select({ id: bugReports.id, accountId: bugReports.accountId, status: bugReports.status })
        .from(bugReports)
        .where(and(eq(bugReports.githubIssueNumber, issueNumber), notDeleted(bugReports)))
        .get() ?? null
    );
  }

  setIssue(id: string, issue: { number: number; url: string }): void {
    this.db
      .update(bugReports)
      .set({ ...touched(null), githubIssueNumber: issue.number, githubIssueUrl: issue.url })
      .where(eq(bugReports.id, id))
      .run();
  }

  setNotionPage(id: string, page: { id: string; url: string }): void {
    this.db
      .update(bugReports)
      .set({ ...touched(null), notionPageId: page.id, notionPageUrl: page.url })
      .where(eq(bugReports.id, id))
      .run();
  }

  setStatus(id: string, status: BugReportStatus, at: Date): void {
    this.db
      .update(bugReports)
      .set({ ...touched(null), status, closedAt: status === 'closed' ? at : null })
      .where(eq(bugReports.id, id))
      .run();
  }
}
