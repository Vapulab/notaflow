import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../httpError';
import type { Identity, IdentityRepository } from '../repos/IdentityRepository';
import { isApiPath } from '../web';
import type { Auth } from './betterAuth';
import { accountContext, adminContext } from './guards';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerAuth(
  app: FastifyInstance,
  deps: { config: Config; identities: IdentityRepository; auth: Auth },
): void {
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request) => {
    // The matched route, not the raw URL: the router decodes %61pi to api before matching.
    const route = request.routeOptions.url;
    if (route === '/api/health' || route === '/api/public/config') return;
    // Better Auth checks the origin of its own routes and needs no session to log in.
    if (route?.startsWith('/api/auth/')) return;
    if (route !== undefined ? !route.startsWith('/api/') : !isApiPath(request.url)) return;
    const identity = await identityOf(request, deps);
    // No user row means the user was removed after the session started.
    if (!identity) throw new HttpError(401, 'unauthenticated');
    if (MUTATIONS.has(request.method)) {
      if (request.headers.origin !== deps.config.appOrigin) throw new HttpError(403, 'bad_origin');
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
        throw new HttpError(415, 'json_required');
      }
    }
    request.identity = identity;
    deps.identities.touchLogin(identity.userId);
  });
  // Membership and admin checks run before body validation, so a stranger gets 404, not 400.
  app.addHook('preValidation', async (request) => {
    const url = request.routeOptions.url ?? '';
    const params = request.params as Record<string, string | undefined>;
    if (url.startsWith('/api/admin/')) adminContext(request);
    if (url.startsWith('/api/accounts/:accountId') && params.accountId) {
      accountContext(request, params.accountId);
    }
  });
}

async function identityOf(
  request: FastifyRequest,
  deps: { config: Config; identities: IdentityRepository; auth: Auth },
): Promise<Identity | null> {
  if (deps.config.auth.mode === 'dev') return deps.identities.findByEmail(deps.config.auth.email);
  const session = await deps.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) throw new HttpError(401, 'unauthenticated');
  return deps.identities.findById(session.user.id);
}
