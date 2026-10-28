import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// The public pages Vite builds as their own HTML entries; without a build, the app serves the root.
const STATIC_PAGES: [string, string][] = [
  ['/', 'landing.html'],
  ['/termos', 'termos.html'],
  ['/privacidade', 'privacidade.html'],
  ['/guia', 'guia/index.html'],
  ['/guia/mei', 'guia/mei.html'],
  ['/guia/simples-nacional', 'guia/simples-nacional.html'],
  ['/guia/primeira-nota', 'guia/primeira-nota.html'],
  ['/guia/rotina-do-mes', 'guia/rotina-do-mes.html'],
  ['/guia/lucro-presumido', 'guia/lucro-presumido.html'],
  ['/guia/calculadora-simples', 'guia/calculadora-simples.html'],
  ['/guia/certificado-digital', 'guia/certificado-digital.html'],
  ['/guia/preciso-de-contador', 'guia/preciso-de-contador.html'],
  ['/guia/glossario', 'guia/glossario.html'],
  ['/guia/reforma-tributaria', 'guia/reforma-tributaria.html'],
];

// The React app's screens (apps/web/src/router.ts); any other page path is a 404.
const APP_PATHS = ['/app', '/admin', '/entrar', '/cadastro', '/recuperar-senha'];

const IMMUTABLE = 'public, max-age=31536000, immutable';

const FALLBACK_404 =
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada | NotaFlow</title>' +
  '<p>Página não encontrada. <a href="/">Ir para o NotaFlow</a></p></html>';

export function registerWeb(app: FastifyInstance, webRoot: string, appOrigin: string): void {
  const assets = join(webRoot, 'assets') + sep;
  app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false,
    index: false,
    cacheControl: false,
    // Vite puts a content hash in every name under assets/, so a new build never reuses a cached file.
    setHeaders: (reply, path) => {
      reply.header('cache-control', path.startsWith(assets) ? IMMUTABLE : 'no-cache');
    },
  });
  for (const [path, file] of STATIC_PAGES) {
    if (existsSync(join(webRoot, file))) app.get(path, (_request, reply) => reply.sendFile(file));
  }

  // The DANFSe link page: any token shape, since the page reads the 404 from the API; kept out of the sitemap.
  if (existsSync(join(webRoot, 'n.html'))) {
    app.get('/n/:token', (_request, reply) =>
      reply.header('x-robots-tag', 'noindex').sendFile('n.html'),
    );
  }

  app.get('/robots.txt', (_request, reply) =>
    reply.type('text/plain; charset=utf-8').send(robotsTxt(appOrigin)),
  );
  app.get('/sitemap.xml', (_request, reply) =>
    reply.type('application/xml; charset=utf-8').send(sitemapXml(appOrigin)),
  );

  const notFoundPage = existsSync(join(webRoot, '404.html'));
  // Without a built landing (development), the root opens the app.
  const appAtRoot = !existsSync(join(webRoot, 'landing.html'));
  app.setNotFoundHandler((request, reply) => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isApiPath(request.url)) {
      return reply.status(404).send({ error: 'not_found' });
    }
    reply.header('x-robots-tag', 'noindex');
    if (isAppPath(request.url, appAtRoot)) return reply.sendFile('index.html');
    reply.status(404).header('cache-control', 'no-cache');
    return notFoundPage
      ? reply.sendFile('404.html')
      : reply.type('text/html; charset=utf-8').send(FALLBACK_404);
  });
}

function isAppPath(url: string, appAtRoot: boolean): boolean {
  const path = new URL(url, 'http://localhost').pathname;
  if (appAtRoot && path === '/') return true;
  return APP_PATHS.some((root) => path === root || path.startsWith(`${root}/`));
}

function robotsTxt(origin: string): string {
  const disallow = [...APP_PATHS, '/n/', '/api/'].map((path) => `Disallow: ${path}\n`).join('');
  return `User-agent: *\nAllow: /\n${disallow}\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemapXml(origin: string): string {
  const urls = STATIC_PAGES.map(([path]) => `  <url><loc>${origin}${path}</loc></url>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}

export function isApiPath(url: string): boolean {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname).startsWith('/api/');
  } catch {
    // A path that does not decode is treated as an API path, so it is authenticated.
    return true;
  }
}
