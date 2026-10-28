import { afterEach, expect, test, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  globalHandlersIntegration: vi.fn(() => ({ name: 'GlobalHandlers' })),
  linkedErrorsIntegration: vi.fn(() => ({ name: 'LinkedErrors' })),
  dedupeIntegration: vi.fn(() => ({ name: 'Dedupe' })),
}));
vi.mock('@sentry/react', () => sentry);

import { NO_DATA, scrubEvent, startErrorTracking, stopErrorTracking } from './errors';

afterEach(() => {
  stopErrorTracking();
  vi.clearAllMocks();
});

test('an event leaves without query strings, headers, e-mails, documents, or breadcrumbs', () => {
  const event = scrubEvent({
    message: 'falhou para pessoa@example.com com CNPJ 12.345.678/0001-95',
    request: {
      url: 'https://notaflow.vapulab.com/app/clientes?q=Fulano',
      headers: { 'User-Agent': 'x' },
    },
    user: { id: 'u1', email: 'pessoa@example.com' },
    exception: { values: [{ type: 'Error', value: 'CPF 11144477735 inválido' }] },
    breadcrumbs: [{ message: 'click' }],
  });
  expect(event.request).toEqual({ url: 'https://notaflow.vapulab.com/app/clientes' });
  expect(event.user).toEqual({ id: 'u1' });
  expect(event.message).toBe('falhou para [e-mail] com CNPJ [documento]');
  expect(event.exception?.values?.[0]?.value).toBe('CPF [documento] inválido');
  expect(event.breadcrumbs).toBeUndefined();
});

test('Sentry starts with no personal data, no breadcrumbs, and the scrubber on every event', async () => {
  await startErrorTracking({
    dsn: 'https://abc@o1.ingest.us.sentry.io/2',
    release: 'abc1234',
    environment: 'production',
  });
  const options = sentry.init.mock.calls[0]?.[0];
  expect(options).toMatchObject({
    dsn: 'https://abc@o1.ingest.us.sentry.io/2',
    release: 'abc1234',
    environment: 'production',
    dataCollection: NO_DATA,
    defaultIntegrations: false,
  });
  expect(options.beforeBreadcrumb()).toBeNull();
  expect(options.beforeSend({ request: { url: 'https://x/app?q=1' } })).toEqual({
    request: { url: 'https://x/app' },
  });
});

test('without a DSN nothing loads', async () => {
  await startErrorTracking(null);
  expect(sentry.init).not.toHaveBeenCalled();
});

test('an e-mail is replaced without the punctuation after it', () => {
  expect(scrubEvent({ message: 'para pessoa@example.com, CNPJ e fulano@ex.com.br.' }).message).toBe(
    'para [e-mail], CNPJ e [e-mail].',
  );
});

test('a link token never leaves in the request URL, the message, or an exception', () => {
  const token = 'b'.repeat(43);
  const event = scrubEvent({
    message: `falhou em /n/${token}`,
    request: { url: `https://notaflow.vapulab.com/n/${token}?x=1` },
    exception: { values: [{ value: `GET /n/${token} 500` }] },
  });
  expect(event.request?.url).toBe('https://notaflow.vapulab.com/n/:token');
  expect(event.message).toBe('falhou em /n/:token');
  expect(event.exception?.values?.[0]?.value).toBe('GET /n/:token 500');
});
