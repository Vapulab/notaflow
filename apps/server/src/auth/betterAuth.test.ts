import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { type Database, openDatabase } from '../db/openDatabase';
import { softDelete } from '../db/stamps';
import { users } from '../db/schema';
import type { MailMessage } from '../mail/mailer';

const ORIGIN = 'http://localhost:3000';
let app: FastifyInstance;
let db: Database;
let mail: MailMessage[];
let closeDb: () => void;
// Better Auth keeps its rate-limit counters per process, so each test speaks from its own IP.
let testIp = 0;
let ip = '';

async function start(env: Record<string, string> = {}) {
  const opened = openDatabase(':memory:');
  db = opened.db;
  closeDb = opened.close;
  mail = [];
  testIp += 1;
  ip = `203.0.113.${testIp}`;
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: ORIGIN,
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
    SIGNUP_OPEN: 'true',
    ...env,
  });
  app = buildApp({
    config,
    db,
    mailer: async (message) => {
      mail.push(message);
    },
    onEmitterCreated: () => {},
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
  closeDb();
});

const post = (url: string, payload: object, remoteAddress?: string, headers = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    remoteAddress: remoteAddress ?? ip,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  });

function lastCode(): string {
  const text = mail.at(-1)?.text ?? '';
  return /\b(\d{6})\b/.exec(text)?.[1] ?? '';
}

async function askCode(email: string, remoteAddress?: string) {
  return post(
    '/api/auth/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    remoteAddress,
  );
}

test('an existing user logs in with an e-mail code and keeps the same id', async () => {
  await start();
  const a = seedTenant(db, { accountName: 'A', email: 'pessoa@example.com' });
  expect((await askCode('pessoa@example.com')).statusCode).toBe(200);
  expect(mail).toHaveLength(1);
  expect(mail[0]?.to).toBe('pessoa@example.com');
  const response = await post('/api/auth/sign-in/email-otp', {
    email: 'pessoa@example.com',
    otp: lastCode(),
  });
  expect(response.statusCode).toBe(200);
  expect((response.json() as { user: { id: string } }).user.id).toBe(a.userId);
  const cookie = [response.headers['set-cookie']].flat().join(';');
  expect(cookie).toContain('notaflow.session_token=');
  expect(cookie.toLowerCase()).toContain('httponly');
  expect(cookie).toContain('SameSite=Lax');
});

test('a new e-mail creates a plain user while signup is open', async () => {
  await start();
  await askCode('nova@example.com');
  const response = await post('/api/auth/sign-in/email-otp', {
    email: 'nova@example.com',
    otp: lastCode(),
  });
  expect(response.statusCode).toBe(200);
  const rows = db.select().from(users).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: 'nova@example.com', platformRole: 'user' });
});

test('with signup closed, a new e-mail gets signup_closed and no user', async () => {
  await start({ SIGNUP_OPEN: 'false' });
  await askCode('nova@example.com');
  const response = await post('/api/auth/sign-in/email-otp', {
    email: 'nova@example.com',
    otp: lastCode(),
  });
  expect(response.statusCode).toBe(403);
  expect((response.json() as { code: string }).code).toBe('signup_closed');
  expect(db.select().from(users).all()).toHaveLength(0);
});

test('after 5 wrong codes the right one is refused', async () => {
  await start();
  seedTenant(db, { accountName: 'A', email: 'pessoa@example.com' });
  await askCode('pessoa@example.com');
  const code = lastCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const r = await post(
      '/api/auth/sign-in/email-otp',
      { email: 'pessoa@example.com', otp: wrong },
      `198.51.100.${i + 10}`,
    );
    expect(r.statusCode).toBe(400);
  }
  const response = await post(
    '/api/auth/sign-in/email-otp',
    { email: 'pessoa@example.com', otp: code },
    '198.51.100.99',
  );
  expect(response.statusCode).toBe(403);
  expect((response.json() as { code: string }).code).toBe('TOO_MANY_ATTEMPTS');
});

test('a code older than 10 minutes is refused', async () => {
  await start();
  seedTenant(db, { accountName: 'A', email: 'pessoa@example.com' });
  await askCode('pessoa@example.com');
  db.$client.prepare('UPDATE auth_verifications SET expires_at = ?').run(Date.now() - 1000);
  const response = await post('/api/auth/sign-in/email-otp', {
    email: 'pessoa@example.com',
    otp: lastCode(),
  });
  expect(response.statusCode).toBe(400);
});

test('a removed user cannot open a session', async () => {
  await start();
  const a = seedTenant(db, { accountName: 'A', email: 'pessoa@example.com' });
  softDelete(db, users, a.userId, null);
  await askCode('pessoa@example.com');
  const response = await post('/api/auth/sign-in/email-otp', {
    email: 'pessoa@example.com',
    otp: lastCode(),
  });
  expect(response.statusCode).toBe(403);
  expect((response.json() as { code: string }).code).toBe('account_removed');
  expect(db.$client.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toEqual({ n: 0 });
});

test('the per-IP signup limit counts the real IP, not a forged internal header', async () => {
  await start({ SIGNUP_LIMIT_PER_IP_DAY: '1' });
  const forged = { 'x-notaflow-client-ip': '192.0.2.50' };
  for (const [email, expected] of [
    ['um@example.com', 200],
    ['dois@example.com', 429],
  ] as const) {
    await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }, ip, forged);
    const response = await post(
      '/api/auth/sign-in/email-otp',
      { email, otp: lastCode() },
      ip,
      forged,
    );
    expect(response.statusCode, email).toBe(expected);
  }
  const rows = db.$client.prepare("SELECT ip FROM audit_log WHERE action = 'auth.signup'").all();
  expect(rows).toEqual([{ ip }]);
});

test('account deletion through Better Auth is disabled', async () => {
  await start();
  const response = await post('/api/auth/delete-user', {});
  expect(response.statusCode).toBe(404);
});
