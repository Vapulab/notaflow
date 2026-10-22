// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetPublicConfig } from '../publicConfig';
import { mountWaitlist } from './waitlist';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

function setup(interest = 'mei') {
  document.body.innerHTML = `<form data-waitlist data-interest="${interest}"></form>`;
  const form = document.querySelector<HTMLFormElement>('form[data-waitlist]');
  if (!form) throw new Error('no form');
  mountWaitlist(form);
  return form;
}

function stubFetch(status: number, body: unknown = null) {
  const fetch = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      url === '/api/public/config'
        ? new Response(JSON.stringify({ turnstileSiteKey: null }), { status: 200 })
        : new Response(body === null ? null : JSON.stringify(body), { status }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function submit(form: HTMLFormElement, email: string) {
  const input = form.querySelector<HTMLInputElement>('input[type="email"]');
  if (!input) throw new Error('no e-mail field');
  input.value = email;
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(form.querySelector('[role="status"]')?.textContent).not.toBe(''));
}

beforeEach(() => {
  resetPublicConfig();
  window.history.replaceState(null, '', '/guia/mei?utm_source=instagram&x=1');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

test('the interest of the page is checked by default, the others are not', () => {
  stubFetch(204);
  const form = setup('lucro_presumido');
  const checked = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .filter((box) => box.checked)
    .map((box) => box.value);
  expect(checked).toEqual(['lucro_presumido']);
  expect(text(form)).toContain('Usamos seu e-mail só para avisar sobre isso.');
  expect(form.querySelector('a[href="/privacidade"]')).not.toBeNull();
});

test('a submit posts the JSON of the endpoint and shows the thanks', async () => {
  const fetch = stubFetch(204);
  const form = setup('mei');
  form.querySelector<HTMLInputElement>('input[value="certificate"]')?.click();
  await submit(form, 'ana@example.com');
  const post = fetch.mock.calls.find(([url]) => url === '/api/public/waitlist');
  const init = post?.[1];
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(init?.body))).toEqual({
    email: 'ana@example.com',
    interests: ['mei', 'certificate'],
    sourcePage: '/guia/mei',
    campaign: 'utm_source=instagram',
  });
  expect(text(form)).toContain('Pronto!');
});

test('a 429 says to try again later', async () => {
  stubFetch(429, { error: 'too_many_requests' });
  const form = setup();
  await submit(form, 'ana@example.com');
  expect(text(form)).toContain('Muitas tentativas. Tente de novo mais tarde.');
});

test('a form with no interest checked does not post', async () => {
  const fetch = stubFetch(204);
  const form = setup();
  form.querySelector<HTMLInputElement>('input[value="mei"]')?.click();
  await submit(form, 'ana@example.com');
  expect(fetch.mock.calls.some(([url]) => url === '/api/public/waitlist')).toBe(false);
  expect(text(form)).toContain('Escolha pelo menos um aviso.');
});
