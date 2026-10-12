import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedUser } from '../test/fixtures';
import { openDatabase } from './db/openDatabase';
import { mailOutbox } from './db/schema';
import { MailOutbox } from './mail/outbox';
import { sendLegalChangeNotice } from './policyNotice';

let opened: ReturnType<typeof openDatabase>;
beforeEach(() => {
  opened = openDatabase(':memory:');
});
afterEach(() => opened.close());

test('the legal change notice goes once to every user who was not removed', () => {
  seedUser(opened.db, 'um@example.com');
  seedUser(opened.db, 'dois@example.com');
  seedUser(opened.db, 'saiu@example.com');
  opened.db.$client
    .prepare("UPDATE users SET deleted_at = 1 WHERE email = 'saiu@example.com'")
    .run();
  const outbox = new MailOutbox(
    opened.db,
    async () => {},
    () => {},
  );
  expect(sendLegalChangeNotice(opened.db, outbox, '2026-10-28')).toBe(2);
  const rows = opened.db
    .select({ to: mailOutbox.to, kind: mailOutbox.kind })
    .from(mailOutbox)
    .all();
  expect(rows.map((r) => r.to).sort()).toEqual(['dois@example.com', 'um@example.com']);
  expect(rows.every((r) => r.kind === 'notice')).toBe(true);
});
