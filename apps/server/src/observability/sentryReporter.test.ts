import { expect, test, vi } from 'vitest';

const scope = vi.hoisted(() => ({ setTag: vi.fn() }));
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((run: (s: typeof scope) => void) => run(scope)),
  onUncaughtExceptionIntegration: vi.fn(() => ({ name: 'OnUncaughtException' })),
  onUnhandledRejectionIntegration: vi.fn(() => ({ name: 'OnUnhandledRejection' })),
  linkedErrorsIntegration: vi.fn(() => ({ name: 'LinkedErrors' })),
}));
vi.mock('@sentry/node', () => sentry);

import { NO_DATA, sentryReporter } from './errors';

test('Sentry starts with no personal data, no automatic instrumentation, and the scrubber; a capture carries its module', () => {
  const reporter = sentryReporter({
    dsn: 'https://abc@o1.ingest.us.sentry.io/1',
    release: 'e3944dc',
    environment: 'production',
  });
  const options = sentry.init.mock.calls[0]?.[0];
  expect(options).toMatchObject({
    release: 'e3944dc',
    environment: 'production',
    dataCollection: NO_DATA,
    defaultIntegrations: false,
  });
  expect(options.beforeBreadcrumb()).toBeNull();
  expect(options.beforeSend({ user: { id: 'u1', email: 'a@b.co' } })).toEqual({
    user: { id: 'u1' },
  });

  const error = new Error('broken');
  reporter.capture(error, { module: 'issue', requestId: 'req-1' });
  expect(scope.setTag).toHaveBeenCalledWith('module', 'issue');
  expect(scope.setTag).toHaveBeenCalledWith('request_id', 'req-1');
  expect(sentry.captureException).toHaveBeenCalledWith(error);
});

test("Sentry's beforeSend runs the shared redaction rules on every text field", () => {
  sentryReporter({
    dsn: 'https://abc@o1.ingest.us.sentry.io/1',
    release: undefined,
    environment: 'test',
  });
  const options = sentry.init.mock.calls.at(-1)?.[0];
  const token = 'Zx9_-'.repeat(8) + 'abc';
  const event = options.beforeSend({
    message: `GET /n/${token} for ana@example.com`,
    request: {
      url: `https://notaflow.vapulab.com/api/public/n/${token}/pdf?limit=1`,
      cookies: { a: 'b' },
    },
    exception: {
      values: [{ type: 'Error', value: 'CPF 111.444.777-35, CNPJ 12.345.678/0001-95' }],
    },
    extra: { to: 'ana@example.com', token: 'abc' },
  });
  expect(event).toEqual({
    message: 'GET /n/:token for ***@example.com',
    request: { url: 'https://notaflow.vapulab.com/api/public/n/:token/pdf' },
    exception: { values: [{ type: 'Error', value: 'CPF ***, CNPJ ***' }] },
    extra: { to: '***@example.com', token: '***' },
  });
});
