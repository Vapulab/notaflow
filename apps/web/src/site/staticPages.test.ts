import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PAGES = ['landing.html', 'termos.html', 'privacidade.html', '404.html'];
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
  // The JSON-LD has arrays of real text, not placeholders.
  const text = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  expect(text).not.toMatch(/\[[^\]]*(e-mail|contato|razão|CNPJ|endereço)[^\]]*\]/i);
});

test('the landing shares an image that the build ships', () => {
  expect(read('landing.html')).toContain('content="https://notaflow.vapulab.com/og.png"');
  expect(existsSync(`${root}public/og.png`)).toBe(true);
});

const clean = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function structuredData(): { '@graph': Record<string, unknown>[] } {
  const blocks = [
    ...read('landing.html').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ];
  expect(blocks).toHaveLength(1);
  return JSON.parse(blocks[0]?.[1] ?? '');
}

const ofType = (type: string) => structuredData()['@graph'].find((node) => node['@type'] === type);

test('the landing tells search engines it is a free web application by Vapulab', () => {
  expect(ofType('SoftwareApplication')).toMatchObject({
    name: 'NotaFlow',
    url: 'https://notaflow.vapulab.com/',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
  });
  expect(ofType('Organization')).toMatchObject({ name: 'Vapulab', url: 'https://vapulab.com' });
  expect(ofType('WebSite')).toMatchObject({
    url: 'https://notaflow.vapulab.com/',
    inLanguage: 'pt-BR',
  });
});

test('the FAQ in the structured data is the FAQ on the page, word for word', () => {
  const html = read('landing.html');
  const onPage = [
    ...html.matchAll(
      /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<span[\s\S]*?<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>/g,
    ),
  ].map((m) => ({ question: clean(m[1] ?? ''), answer: clean(m[2] ?? '') }));
  const faq = ofType('FAQPage') as {
    mainEntity: { name: string; acceptedAnswer: { text: string } }[];
  };
  // After an FAQ edit, `pnpm seo:faq` rewrites the JSON-LD from the page.
  expect(faq.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }))).toEqual(
    onPage,
  );
  expect(onPage.length).toBeGreaterThanOrEqual(10);
});

test('the 404 page stays out of search results and leads back to the site', () => {
  const html = read('404.html');
  expect(html).toContain('<meta name="robots" content="noindex" />');
  expect(html).toContain('href="/"');
});

test('llms.txt sums up the product for AI search, with the links that exist', () => {
  const text = readFileSync(`${root}public/llms.txt`, 'utf8');
  expect(text.startsWith('# NotaFlow\n')).toBe(true);
  expect(text).toMatch(/grátis/i);
  for (const url of text.matchAll(/https:\/\/notaflow\.vapulab\.com(\/[^\s)]*)/g)) {
    expect(ROUTES.has(url[1] ?? ''), url[0]).toBe(true);
  }
});
