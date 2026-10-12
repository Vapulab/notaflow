import { expect, test } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { openDatabase } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { type ErrorReporter, scrubEvent } from './errors';

test('an event leaves without bodies, cookies, headers, query strings, IPs, e-mails, or documents', () => {
  const event = scrubEvent({
    message: 'falhou para pessoa@example.com com CNPJ 12345678000195 e CPF 111.444.777-35',
    request: {
      url: 'https://notaflow.vapulab.com/api/accounts/a1/customers?q=Fulano',
      data: { name: 'Fulano' },
      cookies: { notaflow: 'session' },
      headers: { cookie: 'x', 'user-agent': 'y' },
      query_string: 'q=Fulano',
    },
    user: { id: 'u1', email: 'pessoa@example.com', ip_address: '203.0.113.7' },
    exception: { values: [{ type: 'Error', value: 'cliente 11222333000181 sem endereço' }] },
    breadcrumbs: [{ message: 'GET /api/me' }],
  });
  expect(event.request).toEqual({ url: 'https://notaflow.vapulab.com/api/accounts/a1/customers' });
  expect(event.user).toEqual({ id: 'u1' });
  expect(event.message).toBe('falhou para [e-mail] com CNPJ [documento] e CPF [documento]');
  expect(event.exception?.values?.[0]?.value).toBe('cliente [documento] sem endereço');
  expect(event.breadcrumbs).toBeUndefined();
});

test('a server error is reported with its module; a client error is not', async () => {
  const reported: { error: unknown; module: string }[] = [];
  const reporter: ErrorReporter = {
    capture: (error, context) => reported.push({ error, module: context.module }),
  };
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'session',
    BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
  });
  const opened = openDatabase(':memory:');
  const app = buildApp({ config, db: opened.db, mailer: async () => {}, errorReporter: reporter });
  // Outside /api, so no login stands before the handler.
  app.get('/boom', async () => {
    throw new Error('broken');
  });
  app.get('/missing', async () => {
    throw new HttpError(404, 'not_found');
  });
  expect((await app.inject({ method: 'GET', url: '/boom' })).statusCode).toBe(500);
  expect((await app.inject({ method: 'GET', url: '/missing' })).statusCode).toBe(404);
  await app.close();
  opened.close();
  expect(reported).toHaveLength(1);
  expect(reported[0]).toMatchObject({ module: 'web' });
  expect(String(reported[0]?.error)).toContain('broken');
});
