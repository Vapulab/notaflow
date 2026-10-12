import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { LIFECYCLE_LEGAL_VERSION } from '../legal';

let t: TestApp | undefined;
afterEach(() => t?.close());

const TUESDAY = new Date('2026-10-20T13:00:00Z'); // 10:00 in Sao Paulo
const DAY = 86_400_000;
const daysBefore = (n: number, from = TUESDAY) => new Date(from.getTime() - n * DAY);

async function start(env: Record<string, string> = { LIFECYCLE_START_AT: '2026-10-01' }) {
  t = await createTestApp({ env });
  return t;
}

function app(): TestApp {
  if (!t) throw new Error('start() first');
  return t;
}

function owner(
  email: string,
  options: {
    createdAt: Date;
    step?: string;
    doneAt?: Date;
    accepted?: boolean;
    status?: 'active' | 'suspended';
  },
) {
  const { db } = app();
  const ctx = seedTenant(db, { accountName: email, email, status: options.status ?? 'active' });
  db.$client
    .prepare(
      'UPDATE accounts SET created_at = ?, onboarding_step = ?, onboarding_done_at = ? WHERE id = ?',
    )
    .run(
      options.createdAt.getTime(),
      options.step ?? 'card',
      options.doneAt?.getTime() ?? null,
      ctx.accountId,
    );
  if (options.accepted !== false) {
    db.$client
      .prepare('INSERT OR IGNORE INTO legal_acceptances (user_id, version) VALUES (?, ?)')
      .run(ctx.userId, LIFECYCLE_LEGAL_VERSION);
  }
  return ctx;
}

function issue(accountId: string, issuedAt: Date, environment = 'producao') {
  const { db } = app();
  const emitterId = randomUUID();
  db.$client
    .prepare(
      `INSERT INTO emitters (id, account_id, cnpj, company_name, municipality, simples_nacional, special_regime, dps_series, environment, created_at)
       VALUES (?, ?, ?, 'EMPRESA', '4113700', '3', '0', '900', ?, ?)`,
    )
    .run(emitterId, accountId, randomUUID().slice(0, 14), environment, issuedAt.getTime());
  db.$client
    .prepare(
      `INSERT INTO invoices (id, emitter_id, dps_series, dps_number, status, environment, competence, service_code, description,
       service_cents, net_cents, origin, issued_at, created_at, updated_at)
       VALUES (?, ?, '900', 1, 'issued', ?, '2026-10-01', '010101', 'X', 100, 100, 'app', ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      emitterId,
      environment,
      issuedAt.getTime(),
      issuedAt.getTime(),
      issuedAt.getTime(),
    );
}

function sent() {
  return app()
    .db.$client.prepare(
      `SELECT u.email, l.phase, l.step, l.variant FROM lifecycle_emails l JOIN users u ON u.id = l.user_id ORDER BY l.id`,
    )
    .all() as { email: string; phase: string; step: number; variant: string }[];
}

function queued() {
  return app()
    .db.$client.prepare('SELECT "to" FROM mail_outbox WHERE kind = \'lifecycle\' ORDER BY id')
    .all() as { to: string }[];
}

test('an account stopped at the card gets the first activation e-mail once', async () => {
  await start();
  owner('dono@example.com', { createdAt: daysBefore(2) });
  expect(await app().app.lifecycle.runDue(TUESDAY)).toBe(1);
  expect(sent()).toEqual([
    { email: 'dono@example.com', phase: 'activation', step: 1, variant: 'card' },
  ]);
  expect(queued()).toEqual([{ to: 'dono@example.com' }]);
  expect(await app().app.lifecycle.runDue(new Date(TUESDAY.getTime() + 15 * 60_000))).toBe(0);
});

test('nothing leaves on a weekend, before the start date, or without a start date', async () => {
  await start();
  owner('dono@example.com', { createdAt: daysBefore(2) });
  expect(await app().app.lifecycle.runDue(new Date('2026-10-24T13:00:00Z'))).toBe(0);
  await app().close();
  await start({ LIFECYCLE_START_AT: '2026-12-01' });
  owner('dono@example.com', { createdAt: daysBefore(2) });
  expect(await app().app.lifecycle.runDue(TUESDAY)).toBe(0);
  await app().close();
  await start({});
  owner('dono@example.com', { createdAt: daysBefore(2) });
  expect(await app().app.lifecycle.runDue(TUESDAY)).toBe(0);
});

test('an owner of two stalled accounts gets one e-mail a day', async () => {
  await start();
  owner('dono@example.com', { createdAt: daysBefore(2) });
  owner('dono@example.com', { createdAt: daysBefore(2) });
  expect(await app().app.lifecycle.runDue(TUESDAY)).toBe(1);
  expect(await app().app.lifecycle.runDue(new Date(TUESDAY.getTime() + 3 * 3600_000))).toBe(0);
  expect(await app().app.lifecycle.runDue(new Date(TUESDAY.getTime() + DAY))).toBe(1);
  expect(sent()).toHaveLength(2);
});

test('only owners who accepted the release, of active accounts, who did not opt out, get e-mails', async () => {
  await start();
  const a = owner('dono@example.com', { createdAt: daysBefore(2) });
  const memberId = seedTenant(app().db, {
    accountName: 'outra',
    email: 'membro@example.com',
  }).userId;
  app()
    .db.$client.prepare("UPDATE memberships SET role = 'member' WHERE user_id = ?")
    .run(memberId);
  app()
    .db.$client.prepare(
      "INSERT INTO memberships (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
    )
    .run(randomUUID(), memberId, a.accountId, Date.now());
  owner('suspensa@example.com', { createdAt: daysBefore(2), status: 'suspended' });
  owner('semaceite@example.com', { createdAt: daysBefore(2), accepted: false });
  const out = owner('saiu@example.com', { createdAt: daysBefore(2) });
  app()
    .db.$client.prepare('UPDATE users SET lifecycle_opt_out_at = 1 WHERE id = ?')
    .run(out.userId);
  await app().app.lifecycle.runDue(TUESDAY);
  expect(sent().map((s) => s.email)).toEqual(['dono@example.com']);
});

test('a done account with only test invoices is still waiting for its first invoice', async () => {
  await start();
  const a = owner('dono@example.com', {
    createdAt: daysBefore(20),
    step: 'done',
    doneAt: daysBefore(4),
  });
  issue(a.accountId, daysBefore(3), 'producao_restrita');
  await app().app.lifecycle.runDue(TUESDAY);
  expect(sent()).toEqual([
    { email: 'dono@example.com', phase: 'first_invoice', step: 1, variant: '' },
  ]);
});

test('a new production invoice starts a new reactivation cycle', async () => {
  await start();
  const a = owner('dono@example.com', {
    createdAt: daysBefore(100),
    step: 'done',
    doneAt: daysBefore(99),
  });
  issue(a.accountId, daysBefore(46));
  expect(await app().app.lifecycle.runDue(TUESDAY)).toBe(1);
  issue(a.accountId, TUESDAY);
  const later = new Date(TUESDAY.getTime() + 49 * DAY); // a Tuesday again
  expect(await app().app.lifecycle.runDue(later)).toBe(1);
  expect(sent().map((s) => [s.phase, s.step])).toEqual([
    ['reactivation', 1],
    ['reactivation', 1],
  ]);
});
