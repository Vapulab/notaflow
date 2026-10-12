# Lifecycle E-mails and Policy Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send onboarding, first-invoice, and reactivation reminders, a real welcome e-mail, and show non-material policy changes as a one-time notice instead of a new acceptance.

**Architecture:** A `LifecycleService` in the API server runs every 15 minutes, reads due owners through a platform-scope repository, records each send in an append-only `lifecycle_emails` table, and queues the e-mail in the existing `MailOutbox`. Opt-out is a signed link outside `/api` plus a profile toggle. Policy notices are a constant in `legal.ts`, a column of views, and a banner in the app.

**Tech Stack:** Fastify 5, Drizzle with SQLite (better-sqlite3), Vitest, React 19, Resend.

**Spec:** [RFC_LIFECYCLE_EMAILS.md](../../../RFCS/2026/10/RFC_LIFECYCLE_EMAILS.md)

## Global Constraints

- Branch per PR to `production`; merge deploys. Tests first (Vitest), then `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- No TypeScript non-null assertions; comments one line, only the non-obvious why; English code and docs (Writing Style, no em dash); UI and e-mail text in Brazilian Portuguese.
- Never delete a row: new tables are append-only with `no_delete` triggers; `mail_outbox` rows change status, never disappear.
- Phases and days: `activation` days 1 and 4 from `accounts.created_at`; `first_invoice` days 3 and 7 from `accounts.onboarding_done_at`; `reactivation` days 45 and 90 from the newest `issued_at` of an `origin = 'app'` invoice in `producao`.
- Send only Monday to Friday, 09:00 to 17:00 America/Sao_Paulo; at most one lifecycle e-mail per user per day (from 00:00 America/Sao_Paulo); skip anchors older than 120 days; only owners; only users who accepted the release's `LEGAL_VERSION`; nothing before `LIFECYCLE_START_AT`.
- From `NotaFlow <nao-responda@notaflow.vapulab.com>`, `Reply-To: contato@vapulab.com`, headers `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Lincoln approves the final text of every e-mail before the merge of the PR that ships it.
- Update the C4 component diagram in the PR that adds the `LifecycleService` (render through `http://[::1]:4181`).

## Review Focus

1. An owner of two stalled accounts would get two e-mails in one run; the per-user daily cap must hold across accounts (test in Task 7).
2. An account with invoices only in `producao_restrita` has never issued in production: it is in `first_invoice`, not `reactivation` (test in Task 6).
3. A queued lifecycle e-mail of a user who opts out before delivery must never be sent (test in Task 3 and Task 8).
4. An unsubscribe link of a deleted user, or with a broken token, answers a clear page and changes nothing, never a 500 (test in Task 8).
5. The first run after deploy must not send step 1 to an account whose step 2 is already due, and nothing for anchors older than 120 days (test in Task 6).

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/server/src/db/schema.ts` (accounts, users, mailOutbox; new `lifecycleEmails`, `policyNoticeViews`)
- Modify: `apps/server/src/db/businessTables.ts` (add both tables to `OTHER_TABLES`)
- Create: `apps/server/drizzle/0016_lifecycle.sql` (generated, then the backfill and triggers appended)
- Test: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces: `accounts.onboardingDoneAt` (timestamp_ms, null), `users.lifecycleOptOutAt` (timestamp_ms, null), `mailOutbox.replyTo` (text, null), `mailOutbox.headers` (json text, null), `mailOutbox.kind` adds `'lifecycle'`, `mailOutbox.status` adds `'cancelled'`, tables `lifecycleEmails` and `policyNoticeViews` as in the RFC.

- [ ] **Step 1: Write the failing test** (append to `migrations.test.ts`)

```ts
test('0016 backfills onboarding_done_at from the oldest emitter, and the new tables refuse deletes', () => {
  const dir = migrationsUpTo(15);
  const client = new BetterSqlite3(':memory:');
  migrate(drizzle(client), { migrationsFolder: dir });
  client.prepare(`INSERT INTO accounts (id, name, created_at, onboarding_step) VALUES ('a1', 'A', ${T0}, 'done')`).run();
  client.prepare(`INSERT INTO accounts (id, name, created_at, onboarding_step) VALUES ('a2', 'B', ${T0}, 'card')`).run();
  client.prepare(
    `INSERT INTO emitters (id, account_id, cnpj, legal_name, municipality_ibge, environment, created_at) VALUES ('e1', 'a1', '12345678000195', 'X', '4113700', 'producao', ${T0 + 5000})`,
  ).run();
  migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  const rows = client.prepare('SELECT id, onboarding_done_at AS d FROM accounts ORDER BY id').all();
  expect(rows).toEqual([{ id: 'a1', d: T0 + 5000 }, { id: 'a2', d: null }]);
  client.prepare(`INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'a@b.co', 'A', ${T0})`).run();
  client.prepare(
    `INSERT INTO lifecycle_emails (user_id, account_id, phase, step, variant, anchor_at, sent_at) VALUES ('u1', 'a1', 'activation', 1, 'card', ${T0}, ${T0})`,
  ).run();
  expect(() => client.prepare('DELETE FROM lifecycle_emails').run()).toThrow(/append only/);
  expect(() =>
    client.prepare(
      `INSERT INTO lifecycle_emails (user_id, account_id, phase, step, variant, anchor_at, sent_at) VALUES ('u1', 'a1', 'activation', 1, 'card', ${T0}, ${T0 + 1})`,
    ).run(),
  ).toThrow(/UNIQUE/);
});
```

Before running it, read `seedPre3a` and the `emitters` schema in `schema.ts`, and adjust the `INSERT INTO emitters` and `INSERT INTO users` column lists to the NOT NULL columns of the current schema.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @notaflow/server exec vitest run src/db/migrations.test.ts -t 0016`
Expected: FAIL (no column `onboarding_done_at`).

- [ ] **Step 3: Change the schema**

In `schema.ts`, add to `accounts`: `onboardingDoneAt: integer('onboarding_done_at', { mode: 'timestamp_ms' }),`; to `users`: `lifecycleOptOutAt: integer('lifecycle_opt_out_at', { mode: 'timestamp_ms' }),`; to `mailOutbox`: `replyTo: text('reply_to'),` and `headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),`; extend the `kind` enum with `'lifecycle'` and the `status` enum with `'cancelled'`. Add:

```ts
// One row per lifecycle e-mail sent; the unique index is what stops a second send.
export const lifecycleEmails = sqliteTable(
  'lifecycle_emails',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull().references(() => users.id),
    accountId: text('account_id').notNull().references(() => accounts.id),
    phase: text('phase', { enum: ['activation', 'first_invoice', 'reactivation'] }).notNull(),
    step: integer('step').notNull(),
    variant: text('variant').notNull(),
    anchorAt: integer('anchor_at', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('lifecycle_emails_once').on(t.userId, t.accountId, t.phase, t.step, t.anchorAt)],
);

export const policyNoticeViews = sqliteTable(
  'policy_notice_views',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull().references(() => users.id),
    noticeId: text('notice_id').notNull(),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('policy_notice_views_once').on(t.userId, t.noticeId)],
);
```

Add `'lifecycle_emails'` and `'policy_notice_views'` to `OTHER_TABLES`.

- [ ] **Step 4: Generate and complete the migration**

Run: `pnpm --filter @notaflow/server exec drizzle-kit generate --name lifecycle`
Then append to `drizzle/0016_lifecycle.sql` (keep the `--> statement-breakpoint` separators):

```sql
--> statement-breakpoint
UPDATE `accounts` SET `onboarding_done_at` = (SELECT MIN(`created_at`) FROM `emitters` WHERE `emitters`.`account_id` = `accounts`.`id`) WHERE `onboarding_step` = 'done';--> statement-breakpoint
CREATE TRIGGER `lifecycle_emails_no_update` BEFORE UPDATE ON `lifecycle_emails`
BEGIN SELECT RAISE(ABORT, 'lifecycle e-mails are append only'); END;--> statement-breakpoint
CREATE TRIGGER `lifecycle_emails_no_delete` BEFORE DELETE ON `lifecycle_emails`
BEGIN SELECT RAISE(ABORT, 'lifecycle e-mails are append only'); END;--> statement-breakpoint
CREATE TRIGGER `policy_notice_views_no_update` BEFORE UPDATE ON `policy_notice_views`
BEGIN SELECT RAISE(ABORT, 'policy notice views are append only'); END;--> statement-breakpoint
CREATE TRIGGER `policy_notice_views_no_delete` BEFORE DELETE ON `policy_notice_views`
BEGIN SELECT RAISE(ABORT, 'policy notice views are append only'); END;
```

- [ ] **Step 5: Run the migration tests, then the whole server suite**

Run: `pnpm --filter @notaflow/server exec vitest run src/db` then `pnpm --filter @notaflow/server test`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(server): schema for lifecycle e-mails and policy notices`

---

### Task 2: Record when onboarding ends

**Files:**
- Modify: `apps/server/src/repos/OnboardingRepository.ts` (`markDone`, `advance`)
- Test: `apps/server/src/routes/onboarding.test.ts`

**Interfaces:**
- Consumes: `accounts.onboardingDoneAt` (Task 1).
- Produces: every transition to `'done'` sets `onboardingDoneAt` to now, once.

- [ ] **Step 1: Write the failing test** in `onboarding.test.ts`: run the existing full onboarding helper to `done`, then read the account row and expect `onboardingDoneAt` to be a `Date` within the last minute; and for an account marked done through `markDone`, the same.
- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/routes/onboarding.test.ts -t "done"`; Expected: FAIL (`null`).
- [ ] **Step 3: Implement**: in `markDone`, `.set({ onboardingStep: 'done', onboardingDoneAt: sql\`coalesce(onboarding_done_at, ${Date.now()})\`, ...touched(ctx) })`; in `advance`, spread `...(to === 'done' ? { onboardingDoneAt: new Date() } : {})`.
- [ ] **Step 4: Run** the onboarding tests; Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): record when onboarding ends`

---

### Task 3: Outbox carries reply-to and headers, and skips cancelled rows

**Files:**
- Modify: `apps/server/src/mail/mailer.ts`, `apps/server/src/mail/outbox.ts`
- Test: `apps/server/src/mail/outbox.test.ts`, `apps/server/src/mail/mailer.test.ts`

**Interfaces:**
- Produces: `MailKind` adds `'lifecycle'`; `MailMessage` gets `replyTo?: string` and `headers?: Record<string, string>`; `MailOutbox.queue(message, kind, now): number` inserts a `pending` row without sending (for use inside a transaction); `MailOutbox.cancelPendingLifecycle(to: string): number`; `resendMailer` sends `reply_to` and `headers` when present.

- [ ] **Step 1: Write the failing tests**

```ts
test('a lifecycle e-mail goes out with its reply-to and unsubscribe headers', async () => {
  const sent: MailMessage[] = [];
  const outbox = new MailOutbox(db, async (m) => { sent.push(m); }, () => {});
  outbox.queue(
    { to: 'dono@example.com', subject: 's', html: 'h', text: 't', replyTo: 'contato@vapulab.com',
      headers: { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } },
    'lifecycle', T0,
  );
  await outbox.deliverDue(T0);
  expect(sent[0]).toMatchObject({ replyTo: 'contato@vapulab.com', headers: { 'List-Unsubscribe': '<https://x/u>' } });
});

test('a cancelled lifecycle e-mail is never sent, and only lifecycle rows of that address are cancelled', async () => {
  const sent: MailMessage[] = [];
  const outbox = new MailOutbox(db, async (m) => { sent.push(m); }, () => {});
  outbox.queue({ to: 'dono@example.com', subject: 'a', html: '', text: '' }, 'lifecycle', T0);
  outbox.queue({ to: 'dono@example.com', subject: 'b', html: '', text: '' }, 'invite', T0);
  outbox.queue({ to: 'outro@example.com', subject: 'c', html: '', text: '' }, 'lifecycle', T0);
  expect(outbox.cancelPendingLifecycle('dono@example.com')).toBe(1);
  await outbox.deliverDue(T0);
  expect(sent.map((m) => m.subject).sort()).toEqual(['b', 'c']);
});
```

In `mailer.test.ts`, extend the Resend dispatcher test: a message with `replyTo` and `headers` posts `reply_to` and `headers` in the JSON body; a message without them posts neither key.

- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/mail`; Expected: FAIL (`queue` is not a function).
- [ ] **Step 3: Implement**: `queue` inserts `{ ...message fields, replyTo, headers, kind, status: 'pending', nextAttemptAt: now, createdAt: now }` and returns the id; `attempt` passes `replyTo` and `headers` to the transport when set; `cancelPendingLifecycle` updates `status = 'cancelled'` where `to = ? AND kind = 'lifecycle' AND status = 'pending'`; `resendMailer` adds `...(message.replyTo ? { reply_to: message.replyTo } : {})` and the same for `headers`. Remove the "No reply_to" comment in `mailer.ts`.
- [ ] **Step 4: Run** the mail tests; Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): the outbox carries reply-to and headers, and cancels lifecycle e-mails`

---

### Task 4: Policy notices (server and app)

**Files:**
- Modify: `apps/server/src/legal.ts`, `apps/server/src/routes/me.ts`
- Create: `apps/server/src/repos/PolicyNoticeRepository.ts`
- Create: `apps/web/src/components/PolicyNotice.tsx`; Modify: `apps/web/src/api.ts` (`Me.policyNotice`), `apps/web/src/components/Layout.tsx` (render the banner above the page content)
- Test: `apps/server/src/routes/legal.test.ts`, `apps/web/src/components/PolicyNotice.test.tsx`

**Interfaces:**
- Produces: `export interface PolicyNotice { id: string; date: string; text: string; href: string }`; `export const POLICY_NOTICE: PolicyNotice | null` (null in this release); `meRoutes(app, db, notice = POLICY_NOTICE)` so tests inject one; `GET /api/me` field `policyNotice: PolicyNotice | null`; `POST /api/me/policy-notice` body `{ id: string }` answers 204 and records the view and an audit entry `policy.notice_seen`.

- [ ] **Step 1: Write the failing server tests** in `legal.test.ts`: with an injected notice `{ id: 'n1', date: '2026-11-01', text: 'Incluímos X.', href: '/privacidade' }`, `/api/me` returns it; after `POST /api/me/policy-notice {id:'n1'}` it returns `null`; a POST with another id answers 409 `policy_notice_changed`; with `POLICY_NOTICE = null` the field is `null`; the notice never sets `legalAccepted` to false.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Implement** `PolicyNoticeRepository.hasSeen(userId, id)` and `.see(userId, id)` (insert, `onConflictDoNothing`), the field and the route in `me.ts` (wire the injected notice through `buildApp` deps as `policyNotice?: PolicyNotice | null`).
- [ ] **Step 4: Write the failing web test**: `PolicyNotice` renders the text, a link to `href`, and an "Entendi" button; clicking posts `{ id }` and hides the banner; with `policyNotice: null` it renders nothing.
- [ ] **Step 5: Implement** the banner (Malphas `Alert` with `variant="info"`, one line, the link opens in a new tab) and render it in `Layout`.
- [ ] **Step 6: Run** server and web tests; Expected: PASS.
- [ ] **Step 7: Commit** `feat: policy updates show a notice once instead of asking for acceptance`

---

### Task 5: Terms and privacy texts, and the notice e-mail

**Files:**
- Modify: `apps/web/termos.html` (clause 14), `apps/web/privacidade.html` (section 10, new section "E-mails sobre o uso do NotaFlow", Resend entry, version line), `apps/server/src/legal.ts` (`LEGAL_VERSION` = the release date), `apps/server/src/mail/templates.ts` (`legalChangeEmail(startDate)`)
- Create: `apps/server/src/policyNotice.ts`; Modify: root `package.json` (`"notice:legal": "tsx --env-file=apps/server/.env.local apps/server/src/policyNotice.ts"`)
- Test: `apps/web/src/site/staticPages.test.ts`, `apps/server/src/mail/templates.test.ts`

**Interfaces:**
- Produces: `sendLegalChangeNotice(db, outbox, startDate: string): number` that queues one `notice` e-mail per non-deleted user and returns the count; the script calls it with `process.env.LIFECYCLE_START_AT`.

- [ ] **Step 1: Write the failing tests**: the privacy page has the heading "E-mails sobre o uso do NotaFlow", names "lembretes", "legítimo interesse", "contato@vapulab.com", and lists Resend with "boas-vindas e de lembretes"; `termos.html` clause 14 has "atualização"; `legalChangeEmail('2026-10-28')` mentions the date and links to `/termos` and `/privacidade`; `sendLegalChangeNotice` queues one row per non-deleted user.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Write the texts.** Clause 14 and section 10 take the rule of the RFC ("Terms and privacy policy"): a material change reduces rights, changes the price, or adds a purpose not compatible with the service, with e-mail and in-app notice 15 days before and acceptance; any other change is an update that applies when published and shows in the app. The new section covers the reminders, legitimate interest (art. 7º, IX), only owners, opt-out link and profile toggle, replies to contato@vapulab.com, and 5 years of `lifecycle_emails` as proof that each objection was respected. Bump `LEGAL_VERSION` and the version line of `privacidade.html`.
- [ ] **Step 4: Run** the tests; Expected: PASS. Show Lincoln the new clause, the new section, and the notice e-mail before the merge.
- [ ] **Step 5: Commit** `feat: change rule in the terms, reminders in the privacy policy, and the notice e-mail`

---

### Task 6: The schedule (pure functions)

**Files:**
- Create: `apps/server/src/lifecycle/schedule.ts`
- Test: `apps/server/src/lifecycle/schedule.test.ts`

**Interfaces:**
- Produces:

```ts
export type Phase = 'activation' | 'first_invoice' | 'reactivation';
export const PHASE_DAYS: Record<Phase, [number, number]> = {
  activation: [1, 4],
  first_invoice: [3, 7],
  reactivation: [45, 90],
};
export const MAX_ANCHOR_AGE_DAYS = 120;
export function isBusinessHours(now: Date): boolean; // Mon-Fri 09:00-16:59 America/Sao_Paulo
export function startOfDaySaoPaulo(now: Date): Date;
// The highest step whose day has passed, or null; null too when the anchor is too old.
export function dueStep(phase: Phase, anchor: Date, now: Date): 1 | 2 | null;
export interface Candidate {
  onboardingStep: 'company' | 'card' | 'certificate' | 'fiscal' | 'sync' | 'done';
  accountCreatedAt: Date;
  onboardingDoneAt: Date | null;
  lastProductionIssueAt: Date | null; // newest issued_at of origin 'app' in 'producao'
}
export function phaseOf(c: Candidate): { phase: Phase; anchor: Date; variant: '' | 'card' | 'certificate' | 'fiscal' } | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
const at = (iso: string) => new Date(iso);
test.each([
  ['2026-10-13T12:00:00Z', true],  // Tuesday 09:00 in Sao Paulo
  ['2026-10-13T11:59:00Z', false], // 08:59
  ['2026-10-13T20:00:00Z', false], // 17:00
  ['2026-10-17T15:00:00Z', false], // Saturday
])('business hours at %s: %s', (iso, open) => expect(isBusinessHours(at(iso))).toBe(open));

test('the highest due step, never step 1 when step 2 is due, nothing after 120 days', () => {
  const anchor = at('2026-10-01T12:00:00Z');
  expect(dueStep('activation', anchor, at('2026-10-01T23:00:00Z'))).toBeNull();
  expect(dueStep('activation', anchor, at('2026-10-02T12:00:00Z'))).toBe(1);
  expect(dueStep('activation', anchor, at('2026-10-05T12:00:00Z'))).toBe(2);
  expect(dueStep('reactivation', anchor, at('2026-11-15T12:00:00Z'))).toBe(1);
  expect(dueStep('reactivation', anchor, at('2027-02-01T12:00:00Z'))).toBeNull();
});

test('the phase follows onboarding and production invoices; test invoices do not count', () => {
  const base = { accountCreatedAt: at('2026-10-01T00:00:00Z'), onboardingDoneAt: null, lastProductionIssueAt: null };
  expect(phaseOf({ ...base, onboardingStep: 'company' })).toMatchObject({ phase: 'activation', variant: 'card' });
  expect(phaseOf({ ...base, onboardingStep: 'certificate' })).toMatchObject({ phase: 'activation', variant: 'certificate' });
  expect(phaseOf({ ...base, onboardingStep: 'sync' })).toMatchObject({ phase: 'activation', variant: 'fiscal' });
  const done = { ...base, onboardingStep: 'done' as const, onboardingDoneAt: at('2026-10-03T00:00:00Z') };
  expect(phaseOf(done)).toEqual({ phase: 'first_invoice', anchor: at('2026-10-03T00:00:00Z'), variant: '' });
  expect(phaseOf({ ...done, lastProductionIssueAt: at('2026-10-05T00:00:00Z') })).toEqual({
    phase: 'reactivation', anchor: at('2026-10-05T00:00:00Z'), variant: '',
  });
  expect(phaseOf({ ...done, onboardingDoneAt: null })).toBeNull();
});
```

- [ ] **Step 2: Run** `pnpm --filter @notaflow/server exec vitest run src/lifecycle/schedule.test.ts`; Expected: FAIL.
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })` for the hours and day, and days as `(now - anchor) / 86_400_000`.
- [ ] **Step 4: Run** the tests; Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): the lifecycle schedule`

---

### Task 7: Repository, service, config, and scheduler

**Files:**
- Create: `apps/server/src/repos/LifecycleRepository.ts`, `apps/server/src/lifecycle/LifecycleService.ts`
- Modify: `apps/server/src/config.ts` (`LIFECYCLE_START_AT`), `apps/server/src/app.ts` (decorate `lifecycle`), `apps/server/src/main.ts` (scheduler every 15 minutes)
- Test: `apps/server/src/lifecycle/LifecycleService.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `phaseOf`, `dueStep`, `isBusinessHours`, `startOfDaySaoPaulo` (Task 6); `MailOutbox.queue` (Task 3); `lifecycleEmail(...)` (Task 9; in this task use a stub template `{ subject: phase, html: '', text: '' }` behind the same signature and replace it in Task 9).
- Produces: `config.lifecycleStartAt: Date | null`; `LifecycleRepository.candidates(): CandidateRow[]` where `CandidateRow = Candidate & { accountId: string; userId: string; email: string; name: string }` (owners only, non-deleted active accounts and users, `lifecycle_opt_out_at IS NULL`, accepted `LEGAL_VERSION`); `LifecycleRepository.sentToday(userId, since: Date): boolean`; `LifecycleRepository.recordAndQueue(row, outboxRow): boolean` (one transaction; false on the unique conflict); `LifecycleService.runDue(now: Date): Promise<number>` (count queued); `app.lifecycle: LifecycleService`.

- [ ] **Step 1: Write the failing tests** with `createTestApp({ env: { LIFECYCLE_START_AT: '2026-10-01' } })` and helpers that seed an owner with an accepted `LEGAL_VERSION`:
  - an account created 2 days ago at step `card` gets one `activation` step 1 e-mail with variant `card` on a Tuesday 10:00 run; a second run the same day queues nothing;
  - the same run on Saturday queues nothing; a run with `LIFECYCLE_START_AT` in the future queues nothing;
  - an owner of two stalled accounts gets one e-mail on the first day and the other on the next business day (Review Focus 1);
  - a member (role `member`) gets nothing; a suspended account gets nothing; an opted-out user gets nothing; a user who did not accept the release version gets nothing;
  - a done account with one `producao_restrita` invoice is in `first_invoice` (Review Focus 2);
  - after a production invoice, the `reactivation` anchor moves, so day 45 of the new invoice sends again.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Implement** the repository query (join `memberships` with role `owner`, `accounts`, `users`, `legal_acceptances` on the version, and a correlated `max(issued_at)` of `invoices` with `origin = 'app'` and `environment = 'producao'` over the account's emitters), the service loop (skip by `sentToday`, pick `phaseOf` and `dueStep`, call `recordAndQueue`), the config value (ISO date or empty; invalid is a `ConfigError`), the decoration, and the scheduler in `main.ts`: `startScheduler(() => app.lifecycle.runDue(new Date()), 15 * 60_000, (error) => app.log.error({ err: error }, 'lifecycle run failed'))`.
- [ ] **Step 4: Run** the server suite; Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): the lifecycle service`

---

### Task 8: Opt-out link, page, one-click, and profile toggle

**Files:**
- Create: `apps/server/src/lifecycle/unsubscribe.ts`
- Modify: `apps/server/src/app.ts` (register the routes), `apps/server/src/routes/me.ts` (`lifecycleEmails` field and `PUT /api/me/preferences`), `apps/server/src/web.ts` (`/lembretes` is not an app path; keep the 404 for other paths)
- Modify: `apps/web/src/api.ts`, `apps/web/src/pages/ProfilePage.tsx` (toggle)
- Test: `apps/server/src/lifecycle/unsubscribe.test.ts`, `apps/web/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Produces: `signUnsubscribe(userId: string, secret: string): string` (base64url HMAC-SHA256 with key `HMAC(secret, 'lifecycle-unsubscribe')`); `unsubscribeUrl(origin, userId, secret): string` = `${origin}/lembretes/descadastrar?u=<id>&t=<token>`; `GET /lembretes/descadastrar` answers an HTML page (noindex) with a confirm form; `POST /lembretes/descadastrar?u&t` (any body, form or one-click) sets `lifecycle_opt_out_at`, calls `MailOutbox.cancelPendingLifecycle(email)`, records the audit entry `lifecycle.opt_out`, and answers the done page; `GET /api/me` adds `lifecycleEmails: boolean`; `PUT /api/me/preferences { lifecycleEmails: boolean }` answers 204.

- [ ] **Step 1: Write the failing tests**:
  - a valid token: GET shows the page and changes nothing; POST with `content-type: application/x-www-form-urlencoded` and body `List-Unsubscribe=One-Click` sets the opt-out and cancels a queued lifecycle e-mail (Review Focus 3);
  - a changed token, another user's token, a missing parameter, and a deleted user each answer 400 with the page "Link inválido" and change nothing, never 500 (Review Focus 4);
  - the POST needs no session and no `Origin`;
  - `PUT /api/me/preferences {lifecycleEmails:false}` sets the opt-out; `true` clears it; `/api/me` reflects it;
  - the web toggle on the profile page reads `me.lifecycleEmails` and calls the PUT.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Implement** in an encapsulated Fastify plugin with `addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))`; compare tokens with `timingSafeEqual`; pages in Portuguese with inline styles and `x-robots-tag: noindex`.
- [ ] **Step 4: Run** server and web suites; Expected: PASS.
- [ ] **Step 5: Commit** `feat: opt out of the reminders by link, one click, or the profile`

---

### Task 9: The e-mails

**Files:**
- Modify: `apps/server/src/mail/templates.ts` (`welcomeEmail` rewritten; `lifecycleEmail`)
- Modify: `apps/server/src/lifecycle/LifecycleService.ts` (use `lifecycleEmail` and the unsubscribe URL)
- Test: `apps/server/src/mail/templates.test.ts`

**Interfaces:**
- Produces: `lifecycleEmail(input: { phase: Phase; step: 1 | 2; variant: '' | 'card' | 'certificate' | 'fiscal'; name: string; accountId: string; unsubscribeUrl: string; origin: string }): RenderedMail & { replyTo: string; headers: Record<string, string> }`.

- [ ] **Step 1: Write the failing tests**: for every one of the 9 lifecycle combinations (activation card/certificate/fiscal steps 1 and 2, first_invoice 1 and 2, reactivation 1 and 2): the subject is the RFC's, the html and the text have the unsubscribe URL, every `https://notaflow.vapulab.com` link points to a route that exists (`/entrar`, `/app`, `/app/comecar/<id>`, `/app/<id>/notas/nova`, `/termos`, `/privacidade`), `replyTo` is `contato@vapulab.com`, the two `List-Unsubscribe` headers are set, no text says "não recebe respostas", and the name is escaped in the html. The welcome e-mail has the 4 steps, a link to `/app`, and no unsubscribe link.
- [ ] **Step 2: Run** and see them fail.
- [ ] **Step 3: Write the copy** from the RFC table, each e-mail 60 to 140 words, one button, and the footer "Você recebe este lembrete porque criou uma conta no NotaFlow. Não quer mais receber? <link>". Replace the Task 7 stub.
- [ ] **Step 4: Run** the tests; Expected: PASS. Render the 10 e-mails to `.html` files in the scratchpad and show them to Lincoln for approval; apply his changes before the PR merges.
- [ ] **Step 5: Commit** `feat(server): welcome and lifecycle e-mails`

---

### Task 10: Metrics, panel, diagram, and docs

**Files:**
- Modify: `apps/server/src/metrics/metrics.ts`, `apps/server/src/repos/MetricsRepository.ts` (`notaflow_lifecycle_emails{phase, step}`), `apps/server/src/metrics/server.test.ts` (stub)
- Modify: the dashboard generator and `deploy/monitoring/grafana/dashboards/5-business.json` (a row "Lembretes" with the e-mails per phase per day)
- Modify: `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-3-server-components.mmd` and `.png`, `docs/ENGINEERING/ARCHITECTURE/ONBOARDING.md` (a section on reminders), `apps/server/.env.example` (`LIFECYCLE_START_AT`), `docs/TUTORIALS/DEPLOY_ON_VM.md` (the release steps: deploy, `pnpm notice:legal`, set `LIFECYCLE_START_AT` to 15 days later)
- Test: `apps/server/src/metrics/metrics.test.ts`

- [ ] **Step 1: Write the failing test**: after one `runDue` that queues an activation e-mail, `/metrics` has `notaflow_lifecycle_emails{phase="activation",step="1"} 1`.
- [ ] **Step 2: Run** and see it fail; **Step 3: Implement**; **Step 4: Run** the full suite, lint, and typecheck.
- [ ] **Step 5: Render** the component diagram through `http://[::1]:4181` and check `devicePixelRatio` before the screenshot.
- [ ] **Step 6: Commit** `feat: lifecycle e-mails in the metrics, the panel, the diagram, and the docs`

---

## Delivery

One PR per group, merged in order: Tasks 1 to 4 (schema, outbox, notices); Task 5 (texts, after Lincoln approves them); Tasks 6 to 10 (the service, opt-out, e-mails, metrics). The service ships with `LIFECYCLE_START_AT` unset, so nothing is sent until the release steps in `DEPLOY_ON_VM.md` set it 15 days after the notice e-mail.
