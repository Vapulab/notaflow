import type { FastifyInstance } from 'fastify';
import { requestContext } from '../requestContext';
import { type Auth, CLIENT_IP_HEADER } from './betterAuth';

// Hop and length headers describe the Fastify request, not the one rebuilt for Better Auth.
const DROPPED = new Set([CLIENT_IP_HEADER, 'content-length', 'transfer-encoding', 'connection']);

export function registerAuthRoutes(app: FastifyInstance, auth: Auth, appOrigin: string): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined || DROPPED.has(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const ip = requestContext.getStore()?.ip;
      if (ip) headers.set(CLIENT_IP_HEADER, ip);
      const hasBody = request.method === 'POST' && request.body !== undefined;
      const response = await auth.handler(
        new Request(new URL(request.url, appOrigin), {
          method: request.method,
          headers,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });
}
