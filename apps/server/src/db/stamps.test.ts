import { expect, test } from 'vitest';
import { actorId, created, removed, touched } from './stamps';

const ctx = { accountId: 'a1', userId: 'u1', role: 'owner', accountStatus: 'active' } as const;

test('the scheduler and the system are stored as null', () => {
  expect(actorId({ ...ctx, userId: 'system' })).toBeNull();
  expect(actorId(null)).toBeNull();
  expect(actorId(ctx)).toBe('u1');
  expect(actorId({ userId: 'admin1', admin: true })).toBe('admin1');
});

test('created stamps both authors with one timestamp', () => {
  const stamp = created(ctx);
  expect(stamp).toMatchObject({ createdBy: 'u1', updatedBy: 'u1' });
  expect(stamp.createdAt.getTime()).toBe(stamp.updatedAt.getTime());
});

test('touched and removed move updated_at and name the actor', () => {
  expect(touched(ctx)).toMatchObject({ updatedBy: 'u1', updatedAt: expect.any(Date) });
  expect(removed(ctx)).toMatchObject({
    deletedBy: 'u1',
    updatedBy: 'u1',
    deletedAt: expect.any(Date),
  });
});
