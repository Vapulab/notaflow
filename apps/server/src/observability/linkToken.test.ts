import { expect, test } from 'vitest';
import { scrubEvent } from './errors';
import { redactLinkToken } from './linkToken';

const TOKEN = 'a'.repeat(43);

test('redactLinkToken replaces the token in a page, API, and PDF path', () => {
  expect(redactLinkToken(`/n/${TOKEN}`)).toBe('/n/:token');
  expect(redactLinkToken(`/api/public/n/${TOKEN}/pdf?x=1`)).toBe('/api/public/n/:token/pdf?x=1');
});

test('a Sentry event carries no link token', () => {
  const event = scrubEvent({
    message: `falhou em /n/${TOKEN}`,
    request: { url: `https://notaflow.vapulab.com/api/public/n/${TOKEN}/pdf` },
    exception: { values: [{ value: `GET /n/${TOKEN} quebrou` }] },
  });
  expect(JSON.stringify(event)).not.toContain(TOKEN);
});
