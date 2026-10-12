import { isNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config';
import { type Database, openDatabase } from './db/openDatabase';
import { users } from './db/schema';
import { MailOutbox } from './mail/outbox';
import { legalChangeEmail } from './mail/templates';

// Queues the legal change e-mail for every user who was not removed; the running app's outbox sends it.
export function sendLegalChangeNotice(db: Database, outbox: MailOutbox, startDate: string): number {
  const mail = legalChangeEmail(startDate);
  const recipients = db
    .select({ email: users.email })
    .from(users)
    .where(isNull(users.deletedAt))
    .all();
  for (const { email } of recipients) outbox.queue({ to: email, ...mail }, 'notice');
  return recipients.length;
}

// On the VPS: docker exec notaflow-app-1 node --import tsx apps/server/src/policyNotice.ts 2026-10-28
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const startDate = process.argv[2] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    console.error('Usage: policyNotice.ts <reminders start date, YYYY-MM-DD>');
    process.exit(1);
  }
  const { db } = openDatabase(loadConfig(process.env).databasePath);
  const outbox = new MailOutbox(db, async () => {}, console.error);
  console.log(`Queued ${sendLegalChangeNotice(db, outbox, startDate)} e-mails`);
}
