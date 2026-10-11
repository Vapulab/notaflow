import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PAGES = ['landing.html', 'termos.html', 'privacidade.html'];
// The paths the server answers outside the app (see apps/server/src/web.ts) and the public app pages.
const ROUTES = new Set(['/', '/termos', '/privacidade', '/entrar', '/cadastro']);
const MAILBOXES = new Set(['contato@vapulab.com', 'privacidade@vapulab.com']);

const read = (page: string) => readFileSync(`${root}${page}`, 'utf8');
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');

test.each(PAGES)('every link of %s goes somewhere that exists', (page) => {
  const html = read(page);
  for (const href of hrefs(html)) {
    if (href.startsWith('#')) expect(html, href).toContain(`id="${href.slice(1)}"`);
    else if (href.startsWith('mailto:')) expect(MAILBOXES.has(href.slice(7)), href).toBe(true);
    else if (href.startsWith('https://notaflow.vapulab.com')) {
      expect(ROUTES.has(new URL(href).pathname), href).toBe(true);
    } else if (href.startsWith('/') && !href.startsWith('/favicon')) {
      expect(ROUTES.has(href), href).toBe(true);
    } else expect(href, 'an unexpected link').toBe('/favicon.svg');
  }
});

test.each(PAGES)('%s has a title, a description, and no placeholder left', (page) => {
  const html = read(page);
  expect(html).toMatch(/<title>[^<]+<\/title>/);
  expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
  expect(html).not.toMatch(/\[[^\]]*(e-mail|contato|razão|CNPJ|endereço)[^\]]*\]/i);
});

test('the landing shares an image that the build ships', () => {
  expect(read('landing.html')).toContain('content="https://notaflow.vapulab.com/og.png"');
  expect(existsSync(`${root}public/og.png`)).toBe(true);
});
