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

test('a raw DELETE fails', () => {
  repo.signUp({ email: 'a@x.com', interests: ['mei'], sourcePage: '/guia/mei', campaign: null });
  expect(() => db.$client.prepare('DELETE FROM waitlist_signups').run()).toThrow(
    /soft delete only/,
  );
});
