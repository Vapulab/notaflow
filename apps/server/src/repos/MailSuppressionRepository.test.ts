import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Database, openDatabase } from '../db/openDatabase';
import { MailSuppressionRepository } from './MailSuppressionRepository';

let db: Database;
let close: () => void;
let repo: MailSuppressionRepository;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  repo = new MailSuppressionRepository(db);
});
afterEach(() => close());

describe('MailSuppressionRepository', () => {
  test('add without a reason stores unsubscribe', () => {
    repo.add('a@example.com', 'invoice');
    expect(repo.reasonOf('a@example.com', 'invoice')).toBe('unsubscribe');
  });

  test('a complaint replaces a bounce, a bounce does not replace a complaint or an unsubscribe', () => {
    repo.add('a@example.com', 'invoice', 'bounce');
    repo.add('a@example.com', 'invoice', 'complaint');
    expect(repo.reasonOf('a@example.com', 'invoice')).toBe('complaint');
    repo.add('a@example.com', 'invoice', 'bounce');
    expect(repo.reasonOf('a@example.com', 'invoice')).toBe('complaint');

    repo.add('b@example.com', 'invoice');
    repo.add('b@example.com', 'invoice', 'bounce');
    expect(repo.reasonOf('b@example.com', 'invoice')).toBe('unsubscribe');
  });

  test('lookups ignore case and spaces', () => {
    repo.add(' Pessoa@Example.com ', 'invoice', 'bounce');
    expect(repo.isSuppressed('pessoa@example.com', 'invoice')).toBe(true);
    expect(repo.reasonOf('pessoa@example.com', 'invoice')).toBe('bounce');
  });

  test('reasonOf is null for an unknown address', () => {
    expect(repo.reasonOf('none@example.com', 'invoice')).toBeNull();
  });

  test('unblock lifts only a bounce', () => {
    repo.add('a@example.com', 'invoice', 'bounce');
    repo.add('c@example.com', 'invoice', 'complaint');
    expect(repo.unblock('c@example.com', 'invoice', null)).toBe(false);
    expect(repo.isSuppressed('c@example.com', 'invoice')).toBe(true);

    expect(repo.unblock('a@example.com', 'invoice', null)).toBe(true);
    expect(repo.isSuppressed('a@example.com', 'invoice')).toBe(false);
    expect(repo.unblock('a@example.com', 'invoice', null)).toBe(false);
    expect(
      repo.unblockedRecently('a@example.com', 'invoice', new Date(Date.now() - 30 * 86_400_000)),
    ).toBe(true);
    expect(repo.unblockedRecently('a@example.com', 'invoice', new Date(Date.now() + 60_000))).toBe(
      false,
    );
  });
});
