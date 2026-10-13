import { afterEach, expect, test } from 'vitest';
import { seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { POLICY_NOTICE, type PolicyNotice } from '../legal';

const NOTICE: PolicyNotice = {
  id: 'n1',
  date: '2026-11-01',
  text: 'Incluímos um fornecedor.',
  href: '/privacidade',
};

let t: TestApp | undefined;
afterEach(() => t?.close());

async function appWith(notice: PolicyNotice | null) {
  t = await createTestApp({ policyNotice: notice });
  seedUser(t.db, 'pessoa@example.com');
  const headers = await t.as('pessoa@example.com');
  const app = t.app;
  return {
    me: async () =>
      (await app.inject({ method: 'GET', url: '/api/me', headers })).json<{
        policyNotice: PolicyNotice | null;
        legalAccepted: boolean;
      }>(),
    see: (id: string) =>
      app.inject({ method: 'POST', url: '/api/me/policy-notice', headers, payload: { id } }),
  };
}

test('a policy update is shown once, and seeing it is recorded', async () => {
  const s = await appWith(NOTICE);
  expect((await s.me()).policyNotice).toEqual(NOTICE);
  expect((await s.see('n1')).statusCode).toBe(204);
  expect((await s.me()).policyNotice).toBeNull();
  expect((await s.see('n1')).statusCode).toBe(204);
  const audit = t?.db.$client
    .prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'policy.notice_seen'")
    .get() as { n: number };
  expect(audit.n).toBe(1);
});

test('a notice that changed since the page loaded is refused', async () => {
  const s = await appWith(NOTICE);
  const stale = await s.see('n0');
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toMatchObject({ error: 'policy_notice_changed' });
});

test('a notice never asks for acceptance, and this release has the signup source one', async () => {
  const s = await appWith(NOTICE);
  expect((await s.me()).legalAccepted).toBe(false);
  expect(POLICY_NOTICE?.id).toBe('2026-10-13-signup-source');
  const none = await appWith(null);
  expect((await none.me()).policyNotice).toBeNull();
});

test('a user who accepted a version after the notice does not see it', async () => {
  const s = await appWith(NOTICE);
  const userId = (
    t?.db.$client.prepare("SELECT id FROM users WHERE email = 'pessoa@example.com'").get() as {
      id: string;
    }
  ).id;
  t?.db.$client
    .prepare("INSERT INTO legal_acceptances (user_id, version) VALUES (?, '2026-10-12.2')")
    .run(userId);
  expect((await s.me()).policyNotice).toEqual(NOTICE);
  t?.db.$client
    .prepare("INSERT INTO legal_acceptances (user_id, version) VALUES (?, '2026-11-05')")
    .run(userId);
  expect((await s.me()).policyNotice).toBeNull();
});
