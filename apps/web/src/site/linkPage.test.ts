// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { track } from '../analytics/analytics';
import { mountLinkPage } from './linkPage';

vi.mock('../analytics/analytics', () => ({ track: vi.fn() }));

const TOKEN = 'a'.repeat(43);
const SUMMARY = {
  emitterName: 'Vapulab Ltda',
  number: '123',
  issuedAt: '2026-10-20T15:30:00.000Z',
  netCents: 123456,
  notice: null,
  testEnvironment: false,
};

function stubFetch(status: number, body: unknown = null) {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function mount(status: number, body: unknown = null) {
  document.body.innerHTML = '<main data-link-page></main>';
  const fetch = stubFetch(status, body);
  const root = document.querySelector<HTMLElement>('[data-link-page]');
  if (!root) throw new Error('no root');
  await mountLinkPage(root, TOKEN, 'https://app.test');
  return { root, fetch };
}

const text = (root: Element) => (root.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => vi.mocked(track).mockClear());
afterEach(() => vi.unstubAllGlobals());

test('shows the emitter, number, date, and net amount in pt-BR', async () => {
  const { root, fetch } = await mount(200, SUMMARY);
  expect(fetch).toHaveBeenCalledWith(`/api/public/n/${TOKEN}`);
  const content = text(root);
  expect(content).toContain('Vapulab Ltda');
  expect(content).toContain('NFS-e nº 123');
  expect(content).toContain('20/10/2026');
  expect(content).toMatch(/R\$\s1\.234,56/);
  expect(content).not.toContain('SEM VALIDADE JURÍDICA');
  expect(content).not.toContain('Esta nota foi');
});

test('shows the notice of a cancelled or replaced invoice', async () => {
  expect(text((await mount(200, { ...SUMMARY, notice: 'cancelada' })).root)).toContain(
    'Esta nota foi cancelada.',
  );
  expect(text((await mount(200, { ...SUMMARY, notice: 'substituida' })).root)).toContain(
    'Esta nota foi substituída.',
  );
});

test('marks a test invoice as without legal validity', async () => {
  const { root } = await mount(200, { ...SUMMARY, testEnvironment: true });
  expect(text(root)).toContain('SEM VALIDADE JURÍDICA');
});

test('the download link points at the public PDF', async () => {
  const { root } = await mount(200, SUMMARY);
  const link = [...root.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Baixar PDF');
  expect(link?.getAttribute('href')).toBe(`/api/public/n/${TOKEN}/pdf`);
});

test('the NotaFlow block links to the campaign URL, with a QR code', async () => {
  const { root } = await mount(200, SUMMARY);
  const url = 'https://app.test/?utm_source=danfse_link&utm_medium=referral&utm_campaign=nota';
  const link = [...root.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === 'Conhecer o NotaFlow',
  );
  expect(link?.getAttribute('href')).toBe(url);
  expect(text(root)).toContain('Emita suas NFS-e em segundos com o NotaFlow.');
  await vi.waitFor(() => expect(root.querySelector('[data-qr] svg')).not.toBeNull());
});

test('an unknown token shows the invalid-link message and a link to the landing', async () => {
  const { root } = await mount(404);
  expect(text(root)).toContain('Link inválido ou removido.');
  expect(root.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(track).not.toHaveBeenCalled();
});

test('captures danfse_link_viewed once, without the token', async () => {
  await mount(200, SUMMARY);
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('danfse_link_viewed');
});

test.each([429, 500])(
  'a %s answer asks to try again, not that the link is invalid',
  async (status) => {
    const { root } = await mount(status);
    expect(text(root)).toContain('Não foi possível carregar a nota agora.');
    expect(text(root)).toContain('Tente de novo em alguns minutos.');
    expect(text(root)).not.toContain('Link inválido');
    expect(track).not.toHaveBeenCalled();
  },
);

test('a network failure asks to try again', async () => {
  document.body.innerHTML = '<main data-link-page></main>';
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline'))),
  );
  const root = document.querySelector<HTMLElement>('[data-link-page]');
  if (!root) throw new Error('no root');
  await mountLinkPage(root, TOKEN, 'https://app.test');
  expect(text(root)).toContain('Tente de novo em alguns minutos.');
});

test('every link the page builds opts out of the referrer', async () => {
  const { root } = await mount(200, SUMMARY);
  const links = [...root.querySelectorAll('a')];
  expect(links.length).toBeGreaterThan(0);
  for (const a of links) expect(a.rel).toBe('noreferrer');
});

test('n.html sends no referrer and every link in it is noreferrer', () => {
  const html = readFileSync(resolve(__dirname, '../../n.html'), 'utf8');
  expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  for (const tag of html.match(/<a\s[^>]*>/g) ?? []) expect(tag).toContain('rel="noreferrer"');
});
