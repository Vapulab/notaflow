import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isApiPath } from './web';

const TURNSTILE = 'https://challenges.cloudflare.com';
// Cloudflare adds its Web Analytics beacon to the pages it proxies.
const CLOUDFLARE_BEACON = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_INSIGHTS = 'https://cloudflareinsights.com';

// The sha256 of every inline <script> of the built pages (the theme script that runs before the first paint).
export function inlineScriptHashes(webRoot: string | undefined): string[] {
  if (!webRoot || !existsSync(webRoot)) return [];
  const hashes = new Set<string>();
  for (const file of readdirSync(webRoot).filter((name) => name.endsWith('.html'))) {
    const html = readFileSync(join(webRoot, file), 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const body = match[1] ?? '';
      if (body.trim()) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  return [...hashes];
}

export function registerSecurityHeaders(
  app: FastifyInstance,
  options: { appOrigin: string; posthogHost: string | null; webRoot: string | undefined },
): void {
  const posthog = options.posthogHost
    ? [options.posthogHost, options.posthogHost.replace('.i.posthog.com', '-assets.i.posthog.com')]
    : [];
  const pagePolicy = [
    "default-src 'self'",
    [
      'script-src',
      "'self'",
      ...inlineScriptHashes(options.webRoot),
      TURNSTILE,
      CLOUDFLARE_BEACON,
      ...posthog,
    ].join(' '),
    // React and the Turnstile widget set style attributes; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ['connect-src', "'self'", CLOUDFLARE_INSIGHTS, ...posthog].join(' '),
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const hsts = options.appOrigin.startsWith('https://');

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    reply.header('cross-origin-opener-policy', 'same-origin');
    // Only for this host: vapulab.com has other sites, so no includeSubDomains.
    if (hsts) reply.header('strict-transport-security', 'max-age=31536000');
    // By path, not content type: a 304 of a page has no content type, and the browser keeps its headers.
    reply.header(
      'content-security-policy',
      isApiPath(request.url) ? "default-src 'none'; frame-ancestors 'none'" : pagePolicy,
    );
    return payload;
  });
}
