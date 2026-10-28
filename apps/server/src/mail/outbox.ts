import { and, asc, count, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';

// A transaction handle works too, so a caller can queue in the same transaction as its own rows.
type Writer = Pick<Database, 'insert'>;
import { mailOutbox } from '../db/schema';
import type { MailKind, Mailer, MailMessage } from './mailer';

// Minutes to wait after the 1st, 2nd, 3rd, and 4th failure; the 5th failure is final.
const BACKOFF_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
// A login code expires in 10 minutes (betterAuth.ts); later it only confuses the person.
const CODE_LIFETIME_MS = 10 * 60_000;
const STUCK_MS = 5 * 60_000;

// Stores every e-mail before it goes out, so a Resend outage delays it instead of losing it.
export class MailOutbox {
  constructor(
    private readonly db: Database,
    private readonly transport: Mailer,
    private readonly logError: (line: string) => void,
  ) {}

  // True when delivered now; false when it waits for a retry.
  async send(message: MailMessage, kind: MailKind, now = new Date()): Promise<boolean> {
    const { to, subject, html, text, replyTo, headers, ref } = message;
    const row = this.db
      .insert(mailOutbox)
      .values({
        to,
        subject,
        html,
        text,
        kind,
        replyTo: replyTo ?? null,
        accountId: ref?.accountId ?? null,
        invoiceId: ref?.invoiceId ?? null,
        headers: headers ?? null,
        status: 'sending',
        nextAttemptAt: now,
        createdAt: now,
      })
      .returning({ id: mailOutbox.id })
      .get();
    return this.attempt(row.id, now);
  }

  // Stored as pending for the next deliverDue run; nothing is sent now.
  queue(message: MailMessage, kind: MailKind, now = new Date(), db: Writer = this.db): number {
    const { to, subject, html, text, replyTo, headers, ref } = message;
    return db
      .insert(mailOutbox)
      .values({
        to,
        subject,
        html,
        text,
        kind,
        replyTo: replyTo ?? null,
        accountId: ref?.accountId ?? null,
        invoiceId: ref?.invoiceId ?? null,
        headers: headers ?? null,
        status: 'pending',
        nextAttemptAt: now,
        createdAt: now,
      })
      .returning({ id: mailOutbox.id })
      .get().id;
  }

  // Invoice e-mail rows queued since a time; a cancelled row was never going out.
  countInvoiceMail(where: { accountId?: string; invoiceId?: string }, since: Date): number {
    const filters = [
      eq(mailOutbox.kind, 'invoice'),
      ne(mailOutbox.status, 'cancelled'),
      gte(mailOutbox.createdAt, since),
      ...(where.accountId ? [eq(mailOutbox.accountId, where.accountId)] : []),
      ...(where.invoiceId ? [eq(mailOutbox.invoiceId, where.invoiceId)] : []),
    ];
    return (
      this.db
        .select({ value: count() })
        .from(mailOutbox)
        .where(and(...filters))
        .get()?.value ?? 0
    );
  }

  // An opt-out stops the reminders waiting or dead-lettered, so no retry sends them; they stay as cancelled rows.
  cancelPendingLifecycle(to: string): number {
    return this.db
      .update(mailOutbox)
      .set({ status: 'cancelled', html: '', text: '' })
      .where(
        and(
          eq(mailOutbox.to, to),
          eq(mailOutbox.kind, 'lifecycle'),
          inArray(mailOutbox.status, ['pending', 'failed']),
        ),
      )
      .run().changes;
  }

  // The adapter for code that only knows the Mailer type, such as Better Auth's hooks.
  mailer(): Mailer {
    return async (message) => {
      await this.send(message, message.kind ?? 'notice');
    };
  }

  async deliverDue(now = new Date()): Promise<void> {
    // A send never takes 5 minutes: a row still sending is from a process that stopped mid-send.
    this.db
      .update(mailOutbox)
      .set({ status: 'pending' })
      .where(
        and(
          eq(mailOutbox.status, 'sending'),
          lte(mailOutbox.nextAttemptAt, new Date(now.getTime() - STUCK_MS)),
        ),
      )
      .run();
    const due = this.db
      .select({ id: mailOutbox.id })
      .from(mailOutbox)
      .where(and(eq(mailOutbox.status, 'pending'), lte(mailOutbox.nextAttemptAt, now)))
      .orderBy(asc(mailOutbox.id))
      .all();
    for (const { id } of due) {
      // Claim it first, so a second worker run skips it.
      const claimed = this.db
        .update(mailOutbox)
        .set({ status: 'sending', nextAttemptAt: now })
        .where(and(eq(mailOutbox.id, id), eq(mailOutbox.status, 'pending')))
        .run();
      if (claimed.changes > 0) await this.attempt(id, now);
    }
  }

  failed() {
    return this.db
      .select({
        id: mailOutbox.id,
        kind: mailOutbox.kind,
        to: mailOutbox.to,
        subject: mailOutbox.subject,
        attempts: mailOutbox.attempts,
        lastError: mailOutbox.lastError,
        createdAt: mailOutbox.createdAt,
      })
      .from(mailOutbox)
      .where(eq(mailOutbox.status, 'failed'))
      .orderBy(desc(mailOutbox.id))
      .limit(100)
      .all();
  }

  // A platform admin resends a dead letter; a login code is never resent.
  async retry(id: number, now = new Date()): Promise<boolean> {
    const claimed = this.db
      .update(mailOutbox)
      .set({ status: 'sending', attempts: 0, nextAttemptAt: now })
      .where(
        and(eq(mailOutbox.id, id), eq(mailOutbox.status, 'failed'), ne(mailOutbox.kind, 'code')),
      )
      .run();
    return claimed.changes > 0 ? this.attempt(id, now) : false;
  }

  private async attempt(id: number, now: Date): Promise<boolean> {
    const row = this.db.select().from(mailOutbox).where(eq(mailOutbox.id, id)).get();
    if (!row) return false;
    if (row.kind === 'code' && now.getTime() - row.createdAt.getTime() >= CODE_LIFETIME_MS) {
      this.giveUp(id, row.to, row.attempts, row.lastError ?? 'code expired');
      return false;
    }
    const attempts = row.attempts + 1;
    try {
      await this.transport({
        to: row.to,
        subject: row.subject,
        html: row.html,
        text: row.text,
        kind: row.kind,
        ...(row.replyTo ? { replyTo: row.replyTo } : {}),
        ...(row.headers ? { headers: row.headers } : {}),
      });
    } catch (error) {
      const lastError = String(error).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) {
        this.giveUp(id, row.to, attempts, lastError);
        return false;
      }
      const wait = BACKOFF_MINUTES[attempts - 1] ?? 0;
      this.db
        .update(mailOutbox)
        .set({
          status: 'pending',
          attempts,
          lastError,
          nextAttemptAt: new Date(now.getTime() + wait * 60_000),
        })
        .where(eq(mailOutbox.id, id))
        .run();
      return false;
    }
    this.db
      .update(mailOutbox)
      .set({ status: 'sent', attempts, sentAt: now, html: '', text: '' })
      .where(eq(mailOutbox.id, id))
      .run();
    return true;
  }

  private giveUp(id: number, to: string, attempts: number, lastError: string): void {
    const row = this.db
      .select({ kind: mailOutbox.kind })
      .from(mailOutbox)
      .where(eq(mailOutbox.id, id))
      .get();
    // A dead code is useless and secret: its body goes; an invite keeps it for the admin retry.
    const erase = row?.kind === 'code' ? { html: '', text: '' } : {};
    this.db
      .update(mailOutbox)
      .set({ status: 'failed', attempts, lastError, ...erase })
      .where(eq(mailOutbox.id, id))
      .run();
    this.logError(
      `mail to @${to.split('@')[1] ?? ''} gave up after ${attempts} attempts: ${lastError}`,
    );
  }
}
