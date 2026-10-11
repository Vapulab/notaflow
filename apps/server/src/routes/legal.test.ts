import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { legalAcceptances } from '../db/schema';
import { LEGAL_VERSION } from '../legal';
import { AuditLog } from '../repos/AuditLog';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  seedUser(t.db, 'pessoa@example.com');
});
afterEach(() => t.close());

const me = async () =>
  (
    await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('pessoa@example.com') })
  ).json<{ legalVersion: string; legalAccepted: boolean }>();

const accept = async (version: string) =>
  t.app.inject({
    method: 'POST',
    url: '/api/me/legal-acceptance',
    headers: { ...(await t.as('pessoa@example.com')), 'user-agent': 'Navegador Teste' },
    payload: { version },
  });

test('a user accepts the current terms and privacy policy once, with the date, IP, and browser', async () => {
  expect(await me()).toMatchObject({ legalVersion: LEGAL_VERSION, legalAccepted: false });
  expect((await accept(LEGAL_VERSION)).statusCode).toBe(204);
  expect(await me()).toMatchObject({ legalAccepted: true });
  const rows = t.db.select().from(legalAcceptances).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    version: LEGAL_VERSION,
    userAgent: 'Navegador Teste',
    acceptedAt: expect.any(Date),
  });
  expect(rows[0]?.ip).toBeTruthy();
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    action: 'legal.accept',
    entity: LEGAL_VERSION,
    userEmail: 'pessoa@example.com',
    result: 'ok',
  });
});

test('accepting again keeps the first acceptance', async () => {
  await accept(LEGAL_VERSION);
  expect((await accept(LEGAL_VERSION)).statusCode).toBe(204);
  expect(t.db.select().from(legalAcceptances).all()).toHaveLength(1);
});

test('an acceptance of another version is refused: the user must see the current texts', async () => {
  const response = await accept('2000-01-01');
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: 'legal_version_changed' });
  expect(await me()).toMatchObject({ legalAccepted: false });
});

test('without a session there is no acceptance', async () => {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/me/legal-acceptance',
    payload: { version: LEGAL_VERSION },
  });
  expect(response.statusCode).toBe(401);
});

test('an acceptance is a record: it cannot be changed or deleted', async () => {
  await accept(LEGAL_VERSION);
  expect(() => t.db.run(sql`UPDATE legal_acceptances SET version = 'x'`)).toThrow();
  expect(() => t.db.run(sql`DELETE FROM legal_acceptances`)).toThrow();
});
