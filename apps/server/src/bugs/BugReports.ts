import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { bugReportDeliveries } from '../db/schema';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import {
  BugReportRepository,
  type BugReportForDelivery,
  type BugReportInput,
  type BugReportStatus,
  type StoredImage,
} from '../repos/BugReportRepository';
import { type BugChannelClients, type DiscordEmbed, imagesText, reportLine } from './channels';
import { type BugImage, imageKey } from './images';
import { maskPath, maskPersonalData } from './mask';
import type { R2Client } from './r2';

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
// The screenshots of a resolved report stay this long in R2, then the purge deletes them.
export const IMAGE_RETENTION_MS = 30 * 86400_000;

// The admin page of a report; Notion and Discord link to it, the public issue never does.
export const adminBugPath = (reportId: string) => `/admin/bugs/${reportId}`;

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
  private readonly audit: AuditLog;
  private readonly running = new Set<Promise<void>>();
  // Reports of a user still uploading: they count for the limit before their row exists.
  private readonly inFlight = new Map<string, number>();

  constructor(
    private readonly deps: {
      db: Database;
      clients: BugChannelClients;
      on: BugChannelsOn;
      // The screenshot bucket; null refuses images.
      r2: R2Client | null;
      appOrigin: string;
      logError: (line: string) => void;
    },
  ) {
    this.repo = new BugReportRepository(deps.db);
    this.audit = new AuditLog(deps.db);
  }

  async report(
    ctx: AccountContext,
    input: BugReportInput,
    images: BugImage[] = [],
    now = new Date(),
  ): Promise<string> {
    const since = new Date(now.getTime() - 3600_000);
    const pending = this.inFlight.get(ctx.userId) ?? 0;
    if (this.repo.countByUserSince(ctx, since) + pending >= REPORTS_PER_HOUR) {
      throw new HttpError(429, 'too_many_bug_reports');
    }
    // Hold the slot before the first await, so parallel requests cannot all pass the check.
    this.inFlight.set(ctx.userId, pending + 1);
    try {
      const reportId = randomUUID();
      // The images reach R2 before any row exists: a failed upload leaves no report without its images.
      const stored = await this.storeImages(reportId, images);
      const { on } = this.deps;
      const kinds: Kind[] = [
        ...(on.github ? (['github_issue'] as const) : []),
        ...(on.notion ? (['notion_page'] as const) : []),
        ...(on.discord ? (['discord_report'] as const) : []),
      ];
      try {
        this.deps.db.transaction(() => {
          this.repo.create(ctx, input, reportId);
          this.repo.addImages(ctx, reportId, stored);
          this.queue(reportId, kinds, null, now);
        });
      } catch (error) {
        // No row points at the uploaded objects, and the purge only finds objects through rows.
        await this.removeObjects(stored.map((image) => image.r2Key));
        throw error;
      }
      this.start(reportId, now);
      return reportId;
    } finally {
      const left = (this.inFlight.get(ctx.userId) ?? 1) - 1;
      if (left > 0) this.inFlight.set(ctx.userId, left);
      else this.inFlight.delete(ctx.userId);
    }
  }

  private async storeImages(reportId: string, images: BugImage[]): Promise<StoredImage[]> {
    if (images.length === 0) return [];
    const r2 = this.deps.r2;
    if (!r2) throw new HttpError(400, 'bug_images_unavailable');
    const uploads = images.map((image, index) => ({
      image,
      row: {
        position: index + 1,
        contentType: image.contentType,
        sizeBytes: image.data.length,
        r2Key: imageKey(reportId, index + 1, image.contentType),
      },
    }));
    const stored: StoredImage[] = uploads.map((upload) => upload.row);
    try {
      for (const { image, row } of uploads) {
        await r2.put(row.r2Key, image.data, image.contentType);
      }
    } catch (error) {
      this.deps.logError(`bug report ${reportId}: image upload failed: ${String(error)}`);
      // Every key, also the failed one: R2 may have kept a PUT whose answer timed out.
      await this.removeObjects(stored.map((image) => image.r2Key));
      throw new HttpError(502, 'bug_images_failed');
    }
    return stored;
  }

  // A missing object counts as deleted, so this is safe for keys that never reached R2.
  private async removeObjects(keys: string[]): Promise<void> {
    const r2 = this.deps.r2;
    if (!r2 || keys.length === 0) return;
    const results = await Promise.allSettled(keys.map((key) => r2.delete(key)));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.deps.logError(
          `bug image ${keys[index] ?? ''} left in R2 without a row: ${String(result.reason)}`,
        );
      }
    }
  }

  // Deletes from R2 the images of reports closed more than 30 days ago; a failure waits for the next run.
  async purgeImages(now = new Date()): Promise<number> {
    const r2 = this.deps.r2;
    if (!r2) return 0;
    const closedBefore = new Date(now.getTime() - IMAGE_RETENTION_MS);
    const due = this.repo.imagesToPurge(closedBefore);
    const done = new Map<string, { accountId: string; count: number }>();
    for (const image of due) {
      // A webhook may reopen the report while an earlier delete waits on R2.
      if (!this.repo.closedBefore(image.bugReportId, closedBefore)) continue;
      try {
        await r2.delete(image.r2Key);
      } catch (error) {
        this.deps.logError(`bug report ${image.bugReportId}: image purge failed: ${String(error)}`);
        continue;
      }
      this.repo.markImagePurged(image.id, now);
      const report = done.get(image.bugReportId) ?? { accountId: image.accountId, count: 0 };
      report.count += 1;
      done.set(image.bugReportId, report);
    }
    for (const [reportId, report] of done) {
      this.audit.record({
        userEmail: 'system',
        accountId: report.accountId,
        action: 'bug.images_purge',
        entity: reportId,
        result: 'ok',
        detail: `${report.count} image(s) deleted from R2`,
      });
    }
    return [...done.values()].reduce((sum, report) => sum + report.count, 0);
  }

  // The admin page streams an image from R2; null when the object is gone.
  async image(key: string) {
    const r2 = this.deps.r2;
    if (!r2) throw new HttpError(503, 'bug_images_unavailable');
    return r2.get(key);
  }

  // The GitHub webhook: a closed issue resolves its report, a reopened one opens it again.
  issueChanged(
    issueUrl: string,
    status: BugReportStatus,
    now = new Date(),
  ): { id: string; accountId: string } | null {
    const report = this.repo.byIssueUrl(issueUrl);
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
      // Claim it first, so a second worker run skips it; the claim time is what the stuck reset reads.
      const claimed = this.deps.db
        .update(t)
        .set({ status: 'sending', nextAttemptAt: new Date() })
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
        if (report.githubIssueNumber !== null) return;
        const found = row.attempts > 0 ? await clients.findIssue(report.id) : null;
        if (found) return this.repo.setIssue(report.id, found);
        const issue = await clients.createIssue({
          title: maskPersonalData(report.title),
          body: issueBody(report),
        });
        this.repo.setIssue(report.id, issue);
        return;
      }
      case 'notion_page': {
        if (report.notionPageId !== null) return;
        const found = row.attempts > 0 ? await clients.findNotionPage(report.id) : null;
        if (found) return this.repo.setNotionPage(report.id, found);
        const page = await clients.createNotionPage({
          title: report.title,
          description: report.description,
          accountName: report.accountName,
          reporterEmail: report.reporterEmail,
          screenUrl: `${this.deps.appOrigin}${report.pagePath}`,
          issueUrl: report.githubIssueUrl,
          reportedAt: report.createdAt,
          reportId: report.id,
          adminUrl: `${this.deps.appOrigin}${adminBugPath(report.id)}`,
          imageCount: report.imageCount,
        });
        this.repo.setNotionPage(report.id, page);
        return;
      }
      case 'discord_report':
        return clients.postDiscord({
          content: `Novo bug reportado: ${maskPersonalData(report.title)}`,
          embed: reportEmbed(report, `${this.deps.appOrigin}${adminBugPath(report.id)}`),
        });
      case 'notion_status':
        // No card to move (Notion came later, or its page failed); the current status wins a late retry.
        if (report.notionPageId === null) return;
        return clients.setNotionStatus(
          report.notionPageId,
          report.status === 'closed' ? 'Resolvido' : 'Em análise',
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
export function issueBody(
  report: Pick<BugReportForDelivery, 'id' | 'description' | 'pagePath' | 'imageCount'>,
) {
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
    // The count only: the images are private and the issue is public.
    ...(report.imageCount > 0
      ? [
          `${report.imageCount} ${report.imageCount === 1 ? 'screenshot' : 'screenshots'}, visible to the NotaFlow team.`,
          '',
        ]
      : []),
    reportLine(report.id),
  ].join('\n');
}

function reportEmbed(report: BugReportForDelivery, adminUrl: string): DiscordEmbed {
  const description = maskPersonalData(report.description);
  const fields = [
    { name: 'Conta', value: report.accountName || '(removida)', inline: true },
    { name: 'Tela', value: maskPath(report.pagePath), inline: true },
    ...(report.githubIssueUrl ? [{ name: 'Issue', value: report.githubIssueUrl }] : []),
    ...(report.notionPageUrl ? [{ name: 'Notion', value: report.notionPageUrl }] : []),
    ...(report.imageCount > 0
      ? [{ name: 'Imagens', value: imagesText(report.imageCount), inline: true }]
      : []),
    { name: 'Painel', value: adminUrl },
  ];
  return {
    title: maskPersonalData(report.title),
    description:
      description.length > EXCERPT ? `${description.slice(0, EXCERPT - 1)}…` : description,
    ...(report.githubIssueUrl ? { url: report.githubIssueUrl } : {}),
    fields,
  };
}
