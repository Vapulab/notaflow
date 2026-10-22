// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountCnpjCheck } from './cnpjCheck';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

function setup() {
  document.body.innerHTML = '<div data-cnpj-check></div>';
  const root = document.querySelector<HTMLElement>('[data-cnpj-check]');
  if (!root) throw new Error('no root');
  mountCnpjCheck(root);
  return root;
}

async function check(root: HTMLElement, cnpj: string) {
  const input = root.querySelector<HTMLInputElement>('input[name="cnpj"]');
  const form = root.querySelector('form');
  if (!input || !form) throw new Error('no form');
  input.value = cnpj;
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).not.toBe(''));
}

const answer = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal('fetch', answer(200, { regime: 'simples' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('the check sends only the digits and letters of the CNPJ', async () => {
  const root = setup();
  await check(root, '12.345.678/0001-95');
  expect(fetch).toHaveBeenCalledWith('/api/public/cnpj-regime/12345678000195');
});

test.each([
  ['mei', '/guia/mei'],
  ['simples', '/guia/simples-nacional'],
  ['other', '/guia/lucro-presumido'],
])('the regime %s links to %s', async (regime, path) => {
  vi.stubGlobal('fetch', answer(200, { regime }));
  const root = setup();
  await check(root, '12345678000195');
  expect(root.querySelector(`[role="status"] a[href="${path}"]`)).not.toBeNull();
});

test('other says the company is not in the Simples and to confirm with the accountant', async () => {
  vi.stubGlobal('fetch', answer(200, { regime: 'other' }));
  const root = setup();
  await check(root, '12345678000195');
  expect(text(root)).toContain(
    'Sua empresa não é do Simples Nacional. Pode ser Lucro Presumido ou Lucro Real: confirme com seu contador.',
  );
});

test.each([
  [400, 'invalid_cnpj', 'CNPJ inválido'],
  [404, 'cnpj_not_found', 'Não encontramos'],
  [503, 'cnpj_lookup_unavailable', 'não está disponível'],
  [429, 'too_many_requests', 'Muitas tentativas. Tente de novo mais tarde.'],
])('a %i shows its text', async (status, error, message) => {
  vi.stubGlobal('fetch', answer(status, { error }));
  const root = setup();
  await check(root, '12345678000195');
  expect(text(root)).toContain(message);
});

test('a CNPJ with the wrong length is refused before any call', async () => {
  const root = setup();
  await check(root, '1234');
  expect(fetch).not.toHaveBeenCalled();
  expect(text(root)).toContain('CNPJ inválido');
});

test('a network failure says the lookup is not available', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  const root = setup();
  await check(root, '12345678000195');
  expect(text(root)).toContain('A consulta não está disponível agora.');
});
