import { randomUUID } from 'node:crypto';
import type { AccountContext, AdminContext } from '@notaflow/core';
import { and, asc, count, eq, gte, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, bugReportImages, bugReports, users } from '../db/schema';
import { created, notDeleted, touched } from '../db/stamps';
import type { ImageType } from '../bugs/images';

export interface BugReportInput {
  title: string;
  description: string;
  pagePath: string;
  userAgent: string | null;
}

export type BugReportStatus = 'open' | 'closed';

export interface StoredImage {
  position: number;
  contentType: ImageType;
  sizeBytes: number;
  r2Key: string;
}

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
  imageCount: number;
}

export class BugReportRepository {
  constructor(private readonly db: Database) {}

  // The id comes first: the images go to R2 under it before the row exists.
  create(ctx: AccountContext, input: BugReportInput, id: string = randomUUID()): string {
    this.db
      .insert(bugReports)
      .values({ ...created(ctx), id, accountId: ctx.accountId, ...input })
      .run();
    return id;
  }

  addImages(ctx: AccountContext, reportId: string, images: StoredImage[]): void {
    for (const image of images) {
      this.db
        .insert(bugReportImages)
        .values({
          ...created(ctx),
          id: randomUUID(),
          bugReportId: reportId,
          accountId: ctx.accountId,
          ...image,
        })
        .run();
    }
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
    return row
      ? { ...row, accountName: row.accountName ?? '', imageCount: this.images(id).length }
      : null;
  }

  // Platform scope: the admin page of one report, with its account, its reporter, and its images.
  forAdmin(_ctx: AdminContext, id: string) {
    const row = this.db
      .select({
        id: bugReports.id,
        title: bugReports.title,
        description: bugReports.description,
        pagePath: bugReports.pagePath,
        userAgent: bugReports.userAgent,
        status: bugReports.status,
        closedAt: bugReports.closedAt,
        createdAt: bugReports.createdAt,
        githubIssueUrl: bugReports.githubIssueUrl,
        notionPageUrl: bugReports.notionPageUrl,
        accountId: bugReports.accountId,
        accountName: accounts.name,
        reporterEmail: users.email,
        reporterName: users.name,
      })
      .from(bugReports)
      .leftJoin(accounts, and(eq(accounts.id, bugReports.accountId), notDeleted(accounts)))
      .leftJoin(users, and(eq(users.id, bugReports.createdBy), notDeleted(users)))
      .where(and(eq(bugReports.id, id), notDeleted(bugReports)))
      .get();
    if (!row) return null;
    const images = this.images(id).map((image) => ({
      position: image.position,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
      purgedAt: image.purgedAt,
    }));
    return { ...row, images };
  }

  imageForAdmin(_ctx: AdminContext, reportId: string, position: number) {
    return this.images(reportId).find((image) => image.position === position) ?? null;
  }

  private images(reportId: string) {
    return this.db
      .select()
      .from(bugReportImages)
      .innerJoin(
        bugReports,
        and(eq(bugReports.id, bugReportImages.bugReportId), notDeleted(bugReports)),
      )
      .where(and(eq(bugReportImages.bugReportId, reportId), notDeleted(bugReportImages)))
      .orderBy(asc(bugReportImages.position))
      .all()
      .map((row) => row.bug_report_images);
  }

  // System scope: the purge job acts for no account.
  // Only reports still closed: a reopen clears closed_at, so it cancels the purge.
  imagesToPurge(closedBefore: Date) {
    return this.db
      .select({
        id: bugReportImages.id,
        bugReportId: bugReportImages.bugReportId,
        accountId: bugReportImages.accountId,
        r2Key: bugReportImages.r2Key,
      })
      .from(bugReportImages)
      .innerJoin(bugReports, eq(bugReports.id, bugReportImages.bugReportId))
      .where(
        and(
          isNull(bugReportImages.purgedAt),
          eq(bugReports.status, 'closed'),
          lt(bugReports.closedAt, closedBefore),
          notDeleted(bugReportImages),
          notDeleted(bugReports),
        ),
      )
      .orderBy(asc(bugReportImages.bugReportId), asc(bugReportImages.position))
      .all();
  }

  closedBefore(reportId: string, at: Date): boolean {
    const row = this.db
      .select({ id: bugReports.id })
      .from(bugReports)
      .where(
        and(
          eq(bugReports.id, reportId),
          eq(bugReports.status, 'closed'),
          lt(bugReports.closedAt, at),
          notDeleted(bugReports),
        ),
      )
      .get();
    return row !== undefined;
  }

  markImagePurged(imageId: string, at: Date): void {
    this.db
      .update(bugReportImages)
      .set({ ...touched(null), purgedAt: at })
      .where(and(eq(bugReportImages.id, imageId), isNull(bugReportImages.purgedAt)))
      .run();
  }

  // The issue number is unique in the one repository the reports go to.
  // The URL names the repository too: an issue number alone repeats across repositories.
  byIssueUrl(issueUrl: string): { id: string; accountId: string; status: BugReportStatus } | null {
    return (
      this.db
        .select({ id: bugReports.id, accountId: bugReports.accountId, status: bugReports.status })
        .from(bugReports)
        .where(and(eq(bugReports.githubIssueUrl, issueUrl), notDeleted(bugReports)))
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
