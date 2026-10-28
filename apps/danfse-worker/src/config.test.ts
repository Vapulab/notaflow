import { expect, test } from 'vitest';
import { loadWorkerConfig } from './config';

const ok = {
  REDIS_URL: 'redis://redis:6379',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_DANFSE_ACCESS_KEY_ID: 'key',
  R2_DANFSE_SECRET_ACCESS_KEY: 'secret',
  R2_DANFSE_BUCKET: 'notaflow-danfse',
};

test('reads the settings', () => {
  expect(loadWorkerConfig(ok)).toEqual({
    redisUrl: 'redis://redis:6379',
    r2: {
      accountId: 'a'.repeat(32),
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'notaflow-danfse',
    },
    concurrency: 2,
  });
});

test.each(Object.keys(ok))('refuses a missing %s by name', (name) => {
  expect(() => loadWorkerConfig({ ...ok, [name]: undefined })).toThrow(name);
});

test('refuses a bad account id, bucket, and Redis URL', () => {
  expect(() => loadWorkerConfig({ ...ok, R2_ACCOUNT_ID: 'short' })).toThrow('32-character');
  expect(() => loadWorkerConfig({ ...ok, R2_DANFSE_BUCKET: 'Bad_Bucket' })).toThrow('bucket name');
  expect(() => loadWorkerConfig({ ...ok, REDIS_URL: 'http://x' })).toThrow('redis: URL');
});
