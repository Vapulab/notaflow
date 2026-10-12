import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { signUnsubscribe, unsubscribeUrl } from './unsubscribe';

let t: TestApp;
let userId: string;
let secret: string;
beforeEach(async () => {
  t = await createTestApp();
  userId = seedUser(t.db, 'dono@example.com');
  secret = 'test-secret-'.repeat(4);
});
afterEach(() => t.close());

const optOut = () =>
  (
    t.db.$client
      .prepare('SELECT lifecycle_opt_out_at AS at FROM users WHERE id = ?')
      .get(userId) as {
      at: number | null;
    }
  ).at;
const path = (u: string, token: string) => `/lembretes/descadastrar?u=${u}&t=${token}`;

test('the link is signed for one user and opens a page that changes nothing', async () => {
  expect(unsubscribeUrl('https://notaflow.vapulab.com', userId, secret)).toBe(
    `https://notaflow.vapulab.com/lembretes/descadastrar?u=${userId}&t=${signUnsubscribe(userId, secret)}`,
  );
  const page = await t.app.inject({ url: path(userId, signUnsubscribe(userId, secret)) });
  expect(page.statusCode).toBe(200);
  expect(page.headers['content-type']).toContain('text/html');
  expect(page.headers['x-robots-tag']).toBe('noindex');
  expect(page.body).toContain('<form method="post"');
  expect(optOut()).toBeNull();
});

test('the one-click POST opts out at once and cancels a reminder still in the queue', async () => {
  t.app.mailOutbox.queue({ to: 'dono@example.com', subject: 's', html: '', text: '' }, 'lifecycle');
  const response = await t.app.inject({
    method: 'POST',
    url: path(userId, signUnsubscribe(userId, secret)),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'List-Unsubscribe=One-Click',
  });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('Pronto');
  expect(optOut()).not.toBeNull();
  const status = t.db.$client
    .prepare("SELECT status FROM mail_outbox WHERE kind = 'lifecycle'")
    .get() as {
    status: string;
  };
  expect(status.status).toBe('cancelled');
  const audit = t.db.$client
    .prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'lifecycle.opt_out'")
    .get() as { n: number };
  expect(audit.n).toBe(1);
});

test('a bad link answers a clear page and changes nothing, never an error', async () => {
  const other = seedUser(t.db, 'outra@example.com');
  const gone = seedUser(t.db, 'saiu@example.com');
  t.db.$client.prepare('UPDATE users SET deleted_at = 1 WHERE id = ?').run(gone);
  const bad = [
    path(userId, 'x'.repeat(43)),
    path(userId, signUnsubscribe(other, secret)),
    '/lembretes/descadastrar?u=' + userId,
    '/lembretes/descadastrar',
    path(gone, signUnsubscribe(gone, secret)),
  ];
  for (const url of bad) {
    for (const method of ['GET', 'POST'] as const) {
      const response = await t.app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(400);
      expect(response.body).toContain('Link inválido');
    }
  }
  expect(optOut()).toBeNull();
});

test('the profile turns the reminders off and on', async () => {
  const headers = await t.as('dono@example.com');
  const me = async () =>
    (await t.app.inject({ url: '/api/me', headers })).json<{ lifecycleEmails: boolean }>();
  const set = (on: boolean) =>
    t.app.inject({
      method: 'PUT',
      url: '/api/me/preferences',
      headers,
      payload: { lifecycleEmails: on },
    });
  expect((await me()).lifecycleEmails).toBe(true);
  expect((await set(false)).statusCode).toBe(204);
  expect((await me()).lifecycleEmails).toBe(false);
  expect(optOut()).not.toBeNull();
  await set(true);
  expect((await me()).lifecycleEmails).toBe(true);
  expect(optOut()).toBeNull();
});

test('the one-click POST works with any encoding, and a repeated parameter is a bad link, not an error', async () => {
  const token = signUnsubscribe(userId, secret);
  const repeated = [
    `/lembretes/descadastrar?u=${userId}&u=x&t=${token}`,
    `/lembretes/descadastrar?u=${userId}&t=${token}&t=x`,
  ];
  for (const url of repeated) {
    for (const method of ['GET', 'POST'] as const) {
      const response = await t.app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(400);
    }
  }
  const boundary = 'xYz';
  const multipart = await t.app.inject({
    method: 'POST',
    url: path(userId, token),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}
Content-Disposition: form-data; name="List-Unsubscribe"

One-Click
--${boundary}--
`,
  });
  expect(multipart.statusCode).toBe(200);
  expect(optOut()).not.toBeNull();
});
