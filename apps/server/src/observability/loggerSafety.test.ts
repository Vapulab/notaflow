import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { handleError } from '../httpError';
import { loggerOptions } from './logger';

function logger(lines: string[]) {
  return Fastify({
    logger: { stream: { write: (line: string) => lines.push(line) }, ...loggerOptions },
  });
}

test.each([['oops'], [null], [{ code: 1 }], [42]])('logging { err: %j } never throws', (err) => {
  const lines: string[] = [];
  const app = logger(lines);
  expect(() => app.log.error({ err }, 'boom')).not.toThrow();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('boom');
});

test('a hook or serializer that fails still writes one line', () => {
  const lines: string[] = [];
  const app = logger(lines);
  const hostile = {
    get err(): unknown {
      throw new Error('getter');
    },
  };
  expect(() => app.log.error(hostile, 'x')).not.toThrow();
  expect(lines.join('')).toContain('[log redaction failed]');
});

test('a route that throws a string answers 500 and logs one error line', async () => {
  const lines: string[] = [];
  const app = logger(lines);
  app.setErrorHandler(handleError as never);
  app.get('/boom', async () => {
    throw 'plain string';
  });
  const response = await app.inject({ method: 'GET', url: '/boom' });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: 'internal_error' });
  const errors = lines.map((l) => JSON.parse(l) as { level: number }).filter((e) => e.level === 50);
  expect(errors).toHaveLength(1);
});
