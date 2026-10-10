import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../httpError';
import type { IdentityRepository } from '../repos/IdentityRepository';
import type { VerifyAccessToken } from './accessVerifier';
import { isApiPath } from '../web';
import { accountContext, adminContext } from './guards';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerAuth(
  app: FastifyInstance,
  deps: { config: Config; identities: IdentityRepository; verifyAccessToken: VerifyAccessToken },
): void {
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request) => {
    // The matched route, not the raw URL: the router decodes %61pi to api before matching.
    const route = request.routeOptions.url;
    if (route === '/api/health') return;
    if (route !== undefined ? !route.startsWith('/api/') : !isApiPath(request.url)) return;
    const email = await emailOf(request, deps.config, deps.verifyAccessToken);
    const identity = deps.identities.findByEmail(email);
    if (!identity) throw new HttpError(403, 'access_not_granted');
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

async function emailOf(
  request: FastifyRequest,
  config: Config,
  verify: VerifyAccessToken,
): Promise<string> {
  if (config.auth.mode === 'dev') return config.auth.email;
  const token = request.headers['cf-access-jwt-assertion'];
  if (typeof token !== 'string' || token === '') throw new HttpError(401, 'unauthenticated');
  try {
    return await verify(token);
  } catch (error) {
    request.log.warn(
      { reason: (error as { code?: string }).code ?? (error as Error).name },
      'access token rejected',
    );
    throw new HttpError(401, 'unauthenticated');
  }
}
