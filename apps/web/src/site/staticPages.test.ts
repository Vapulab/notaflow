import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { GUIDE_PAGES } from './guide/pages';

const root = fileURLToPath(new URL('../../', import.meta.url));
const GUIDE_FILES = GUIDE_PAGES.map((page) => page.file);
const PARTIALS = ['partials/guide-header.html', 'partials/guide-footer.html'];
const PAGES = [
  'landing.html',
  'termos.html',
  'privacidade.html',
  '404.html',
  'n.html',
  ...GUIDE_FILES,
];
// The paths the server answers outside the app (see apps/server/src/web.ts) and the public app pages.
const ROUTES = new Set([
  '/',
  '/termos',
  '/privacidade',
  '/entrar',
  '/cadastro',
  ...GUIDE_PAGES.map((page) => page.path),
]);
const MAILBOXES = new Set(['contato@vapulab.com', 'privacidade@vapulab.com']);

const read = (page: string) => readFileSync(`${root}${page}`, 'utf8');
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');

test.each([...PAGES, ...PARTIALS])('every link of %s goes somewhere that exists', (page) => {
  const html = read(page);
  for (const href of hrefs(html)) {
    // A partial's skip link points at the <main> of the page that includes it.
    if (href.startsWith('#') && page.startsWith('partials/')) continue;
    if (href.startsWith('#')) expect(html, href).toContain(`id="${href.slice(1)}"`);
    else if (href.startsWith('mailto:')) expect(MAILBOXES.has(href.slice(7)), href).toBe(true);
    // The guide cites its sources: only official government sites.
    else if (
      GUIDE_FILES.includes(page) &&
      href.startsWith('https://') &&
      !href.startsWith('https://notaflow.vapulab.com')
    ) {
      const host = new URL(href).hostname;
      expect(host === 'gov.br' || host.endsWith('.gov.br'), href).toBe(true);
    } else if (href.startsWith('/guia') && href.includes('#')) {
      const [path = '', id = ''] = href.split('#');
      const target = GUIDE_PAGES.find((guide) => guide.path === path);
      expect(target, href).toBeDefined();
      expect(read(target?.file ?? ''), href).toContain(`id="${id}"`);
    } else if (href.startsWith('https://notaflow.vapulab.com')) {
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

const section = (html: string, heading: string) => {
  const start = html.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('<h2', start + heading.length));
};

test('the privacy policy explains the reminder e-mails, their basis, and how to stop them', () => {
  const reminders = section(read('privacidade.html'), 'E-mails sobre o uso do NotaFlow');
  for (const words of [
    'lembretes',
    'legítimo interesse',
    'dono da conta',
    'descadastr',
    'contato@vapulab.com',
    '5 anos',
  ]) {
    expect(reminders, words).toContain(words);
  }
  expect(read('privacidade.html')).toContain('de convite, de boas-vindas e de lembretes');
  // The service skips weekends, not holidays: the text promises only what the code does.
  expect(reminders).toContain('de segunda a sexta');
  expect(reminders).not.toContain('dia útil');
});

test('the privacy policy says it keeps the campaign link of the signup, why, and on what basis', () => {
  const data = section(
    read('privacidade.html'),
    'Que dados tratamos, para quê e com que base legal',
  );
  expect(data).toMatch(/link de campanha[^<]*cadastro/);
  expect(data).toContain('canais de divulgação');
});

test('the privacy policy explains the screenshots of a bug report: what, why, where, who, and how long', () => {
  const policy = read('privacidade.html');
  expect(policy).toContain('Atualizada em 21 de outubro de 2026');
  expect(policy).toContain('Atualizada em 28 de outubro de 2026');
  const data = section(policy, 'Que dados tratamos, para quê e com que base legal');
  expect(data).toContain('relato de bug');
  expect(data).toContain('dados dos clientes da sua empresa');
  expect(data).toContain('Reproduzir e corrigir o bug');
  expect(data).toContain('Só a equipe do NotaFlow');
  expect(section(policy, 'Com quem compartilhamos')).toContain('Cloudflare R2');
  expect(section(policy, 'Por quanto tempo guardamos')).toContain(
    'até 30 dias depois que ele é corrigido',
  );
});

test('the terms and the policy separate a material change (acceptance, 15 days) from an update (notice)', () => {
  const terms = section(read('termos.html'), 'Mudanças nestes termos');
  const policy = section(read('privacidade.html'), 'Mudanças nesta política');
  for (const text of [terms, policy]) {
    expect(text).toContain('15 dias');
    expect(text).toMatch(/atualização/i);
    expect(text).toContain('aceite');
  }
});

const AVISO =
  'Este guia explica as regras gerais e não substitui a orientação de um profissional. Em caso de dúvida, consulte um contador de sua confiança.';

test('the guide footer carries the fixed Aviso', () => {
  expect(read('partials/guide-footer.html')).toContain(AVISO);
});

test.each(GUIDE_PAGES)(
  'guide page $path has its title, canonical, markers, and structured data',
  (page) => {
    const html = read(page.file);
    expect(html).toContain(`<title>${page.title} | NotaFlow</title>`);
    expect(html).toContain(
      `<link rel="canonical" href="https://notaflow.vapulab.com${page.path}" />`,
    );
    expect(html).toContain('<!--partial:guide-header-->');
    expect(html).toContain('<!--partial:guide-footer-->');
    expect(html).toContain('<section id="fontes"');
    expect(html).toContain('<time datetime="2026-10-21">21 de outubro de 2026</time>');
    expect(html).toContain('src="/src/site/guide/guide.ts"');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    const graph = JSON.parse(blocks[0]?.[1] ?? '')['@graph'] as Record<string, unknown>[];
    const article = graph.find((node) => node['@type'] === 'Article');
    const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList') as
      { itemListElement: unknown[] } | undefined;
    expect(article).toMatchObject({ inLanguage: 'pt-BR', dateModified: '2026-10-21' });
    expect(crumbs?.itemListElement).toHaveLength(page.path === '/guia' ? 2 : 3);
  },
);

test('the landing links the guide in the header and the footer', () => {
  const html = read('landing.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const footer = html.slice(html.indexOf('<footer class="border-t'));
  expect(header).toContain('href="/guia"');
  expect(footer).toContain('href="/guia"');
});

test('the privacy policy has one section on the notify-me list', () => {
  const html = clean(read('privacidade.html'));
  expect(html).toContain('Lista de aviso sobre novidades');
  for (const part of [
    'e-mail',
    'interesses',
    'página',
    'campanha',
    'privacidade@vapulab.com',
    'até que',
  ])
    expect(html, part).toContain(part);
});

test('the guide page on the first invoice describes the band 6 ISS field', () => {
  const html = read('guia/primeira-nota.html');
  expect(html).toContain('id="campo-iss-faixa-6"');
  expect(html).toContain('ISS na faixa 6');
});

test('llms.txt points to the guide', () => {
  const text = read('public/llms.txt');
  expect(text).toContain('https://notaflow.vapulab.com/guia');
  expect(text).toContain('https://notaflow.vapulab.com/guia/certificado-digital');
});

test('the privacy policy covers the invoice PDF, the public link, the e-mail to the customer, and the do-not-send list', () => {
  const policy = read('privacidade.html');
  const data = section(policy, 'Que dados tratamos, para quê e com que base legal');
  for (const words of ['DANFSe', 'link público', 'lista de não envio'])
    expect(data, words).toContain(words);
  expect(section(policy, 'Com quem compartilhamos')).toContain('revogar o link');
  const keep = section(policy, 'Por quanto tempo guardamos');
  for (const words of ['PDFs das notas', 'revogar o link', 'Lista de não envio'])
    expect(keep, words).toContain(words);
  expect(section(policy, 'E-mails sobre o uso do NotaFlow')).toContain('tomador');
});
