import { afterEach, beforeEach, expect, test } from 'vitest';
import { adminOf } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { WaitlistRepository } from './WaitlistRepository';

let db: Database;
let close: () => void;
let repo: WaitlistRepository;
const admin = adminOf('admin-1');
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  repo = new WaitlistRepository(db);
});
afterEach(() => close());

test('signUp lowercases and trims the e-mail, with a null actor', () => {
  repo.signUp({
    email: '  Ana@X.com ',
    interests: ['mei'],
    sourcePage: '/guia/mei',
    campaign: null,
  });
  const [row] = repo.list(admin);
  expect(row?.email).toBe('ana@x.com');
  expect(row?.interests).toEqual(['mei']);
  const raw = db.$client.prepare('SELECT created_by, updated_by FROM waitlist_signups').get() as {
    created_by: string | null;
    updated_by: string | null;
  };
  expect(raw).toEqual({ created_by: null, updated_by: null });
});

test('a repeat merges interests and keeps the first source page and campaign', () => {
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/guia/mei', campaign: 'c1' });
  repo.signUp({
    email: 'A@x.com',
    interests: ['certificate', 'mei'],
    sourcePage: '/guia/certificado-digital',
    campaign: 'c2',
  });
  const rows = repo.list(admin);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.interests).toEqual(['mei', 'certificate']);
  expect(rows[0]?.sourcePage).toBe('/guia/mei');
  const raw = db.$client.prepare('SELECT campaign FROM waitlist_signups').get() as {
    campaign: string | null;
  };
  expect(raw.campaign).toBe('c1');
});

test('remove then signUp again creates a new row; list and counts skip removed rows', () => {
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/guia/mei', campaign: null });
  repo.signUp({
    email: 'b@x.com',
    interests: ['mei', 'certificate'],
    sourcePage: '/p',
    campaign: null,
  });
  const first = repo.list(admin).find((r) => r.email === 'a@x.com');
  expect(first).toBeDefined();
  expect(repo.remove(admin, first?.id ?? '')).toBe(true);
  expect(repo.remove(admin, first?.id ?? '')).toBe(false);
  expect(repo.list(admin).map((r) => r.email)).toEqual(['b@x.com']);
  expect(repo.counts(admin)).toEqual({ mei: 1, lucro_presumido: 0, certificate: 1 });
  repo.signUp({
    email: 'a@x.com',
    interests: ['lucro_presumido'],
    sourcePage: '/q',
    campaign: null,
  });
  const again = repo.list(admin).find((r) => r.email === 'a@x.com');
  expect(again?.id).not.toBe(first?.id);
  expect(again?.interests).toEqual(['lucro_presumido']);
  expect(again?.sourcePage).toBe('/q');
});

test('remove replaces the e-mail with a placeholder and clears the campaign', () => {
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/guia/mei', campaign: 'c1' });
  const id = repo.list(admin)[0]?.id ?? '';
  expect(repo.remove(admin, id)).toBe(true);
  const raw = db.$client
    .prepare('SELECT email, campaign, deleted_at, deleted_by FROM waitlist_signups WHERE id = ?')
    .get(id) as {
    email: string;
    campaign: string | null;
    deleted_at: number | null;
    deleted_by: string;
  };
  expect(raw.email).toBe(`removed:${id}`);
  expect(raw.campaign).toBeNull();
  expect(raw.deleted_at).not.toBeNull();
  expect(raw.deleted_by).toBe('admin-1');
  const all = db.$client
    .prepare("SELECT COUNT(*) AS n FROM waitlist_signups WHERE email = 'a@x.com'")
    .get() as { n: number };
  expect(all.n).toBe(0);
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/q', campaign: null });
  expect(repo.list(admin).map((r) => r.email)).toEqual(['a@x.com']);
});

test('a raw DELETE fails', () => {
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/guia/mei', campaign: null });
  expect(() => db.$client.prepare('DELETE FROM waitlist_signups').run()).toThrow(
    /soft delete only/,
  );
});
