import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { OnboardingRepository } from '../repos/OnboardingRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const call = async (method: 'GET' | 'POST', url: string, email: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: await t.as(email),
    ...(method === 'POST' ? { payload: payload ?? {} } : {}),
  });

async function newAccount(email = 'nova@example.com') {
  seedUser(t.db, email);
  const response = await call('POST', '/api/onboarding/account', email, { name: 'Minha Empresa' });
  expect(response.statusCode).toBe(201);
  return (response.json() as { accountId: string }).accountId;
}

test('a new user names the account, becomes its owner, and goes to the card step', async () => {
  const accountId = await newAccount();
  const me = await call('GET', '/api/me', 'nova@example.com');
  expect(me.json()).toMatchObject({
    accounts: [{ id: accountId, name: 'Minha Empresa', role: 'owner', onboardingStep: 'card' }],
  });
  const state = await call('GET', `/api/accounts/${accountId}/onboarding`, 'nova@example.com');
  expect(state.json()).toEqual({ step: 'card', draft: null });
  const entry = t.db.$client
    .prepare("SELECT result FROM audit_log WHERE action = 'account.create'")
    .get();
  expect(entry).toEqual({ result: 'ok' });
});

test('a user who already belongs to an account cannot create another one this way', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const response = await call('POST', '/api/onboarding/account', 'a@example.com', {
    name: 'Outra',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'already_member' });
});

test('an empty or overlong name is refused', async () => {
  seedUser(t.db, 'nova@example.com');
  for (const name of ['', '   ', 'x'.repeat(121)]) {
    const response = await call('POST', '/api/onboarding/account', 'nova@example.com', { name });
    expect(response.statusCode, JSON.stringify(name)).toBe(400);
  }
});

test('the steps move only forward and only from the step they expect', async () => {
  const accountId = await newAccount();
  const repo = new OnboardingRepository(t.db);
  const ctx = { accountId, userId: 'u', role: 'owner' as const, accountStatus: 'active' as const };
  expect(repo.advance(ctx, 'certificate', 'fiscal')).toBe(false);
  expect(repo.step(ctx)).toBe('card');
  expect(repo.advance(ctx, 'card', 'certificate')).toBe(true);
  expect(repo.advance(ctx, 'card', 'certificate')).toBe(false);

  const early = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/fiscal-done`,
    'nova@example.com',
  );
  expect(early.statusCode).toBe(409);
  expect(early.json()).toMatchObject({ error: 'onboarding_step', step: 'certificate' });

  repo.advance(ctx, 'certificate', 'fiscal');
  const fiscal = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/fiscal-done`,
    'nova@example.com',
  );
  expect(fiscal.statusCode).toBe(200);
  expect(fiscal.json()).toEqual({ step: 'sync' });
  const finish = await call(
    'POST',
    `/api/accounts/${accountId}/onboarding/finish`,
    'nova@example.com',
  );
  expect(finish.json()).toEqual({ step: 'done' });
});

test('only the owner moves the steps', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'dono@example.com' });
  seedTenant(t.db, { accountName: 'B', email: 'membro@example.com' });
  t.db.$client
    .prepare(
      "INSERT INTO memberships (id, user_id, account_id, role) SELECT 'm9', id, ?, 'member' FROM users WHERE email = 'membro@example.com'",
    )
    .run(a.accountId);
  for (const step of ['fiscal-done', 'finish']) {
    const response = await call(
      'POST',
      `/api/accounts/${a.accountId}/onboarding/${step}`,
      'membro@example.com',
    );
    expect(response.statusCode, step).toBe(403);
  }
});
