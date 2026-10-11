import { expect, test } from 'vitest';
import { seedUser } from '../test/fixtures';
import { openDatabase } from './db/openDatabase';
import { IdentityRepository } from './repos/IdentityRepository';
import { seedAdmin } from './seed';

test('seedAdmin creates a platform admin once and promotes an existing user', () => {
  const { db, close } = openDatabase(':memory:');
  expect(seedAdmin(db, 'Admin@Example.com', 'Admin')).toMatchObject({ created: true });
  expect(seedAdmin(db, 'admin@example.com', 'Admin')).toMatchObject({ created: false });
  expect(new IdentityRepository(db).findByEmail('admin@example.com')?.platformRole).toBe('admin');

  seedUser(db, 'user@example.com');
  seedAdmin(db, 'user@example.com', 'User');
  expect(new IdentityRepository(db).findByEmail('user@example.com')?.platformRole).toBe('admin');
  close();
});

test('a seeded admin counts as a verified e-mail, so Google can link to it', () => {
  const { db, close } = openDatabase(':memory:');
  seedAdmin(db, 'admin@example.com', 'Admin');
  expect(db.$client.prepare('SELECT email_verified FROM users').get()).toEqual({
    email_verified: 1,
  });
  close();
});
