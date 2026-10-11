import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// The public pages Vite builds as their own HTML entries; without a build, the app serves the root.
const STATIC_PAGES: [string, string][] = [
  ['/', 'landing.html'],
  ['/termos', 'termos.html'],
  ['/privacidade', 'privacidade.html'],
];

export function registerWeb(app: FastifyInstance, webRoot: string): void {
  app.register(fastifyStatic, { root: webRoot, wildcard: false, index: false });
  for (const [path, file] of STATIC_PAGES) {
    if (existsSync(join(webRoot, file))) app.get(path, (_request, reply) => reply.sendFile(file));
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !isApiPath(request.url)) return reply.sendFile('index.html');
    return reply.status(404).send({ error: 'not_found' });
  });
}

export function isApiPath(url: string): boolean {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname).startsWith('/api/');
  } catch {
    // A path that does not decode is treated as an API path, so it is authenticated.
    return true;
  }
}
