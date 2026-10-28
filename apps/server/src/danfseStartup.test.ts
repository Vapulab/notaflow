import { afterEach, expect, test } from 'vitest';
import { createTestApp, type TestApp } from '../test/testApp';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('a bad DANFSe setup keeps the app up, logs an error, and reports it', async () => {
  const lines: string[] = [];
  const captured: unknown[] = [];
  t = await createTestApp({
    env: { REDIS_URL: 'redis://redis:6379' },
    logStream: { write: (line) => lines.push(line) },
    errorReporter: { capture: (error) => captured.push(error) },
  });
  expect(t.app.danfse).toBeNull();
  const logged = lines.map((line) => JSON.parse(line) as { level: number; msg: string });
  expect(logged.some((l) => l.level === 50 && l.msg.includes('DANFSe queue is off'))).toBe(true);
  expect(captured).toHaveLength(1);
  expect(String(captured[0])).toContain('go together');
});

test('a clean setup logs no DANFSe warning', async () => {
  const lines: string[] = [];
  t = await createTestApp({ logStream: { write: (line) => lines.push(line) } });
  expect(lines.join('')).not.toContain('DANFSe queue is off');
});
