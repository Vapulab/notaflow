import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { verifyTurnstile } from '../auth/turnstileVerify';
import type { Config } from '../config';
import type { Database } from '../db/openDatabase';
import { isValidCnpj } from '../domain/documents';
import { HttpError } from '../httpError';
import { LookupError, lookupCnpj } from '../onboarding/cnpjLookup';
import { visitorIp } from '../requestContext';
import { createRateLimiter } from '../rateLimit';
import {
  WAITLIST_INTERESTS,
  type WaitlistInterest,
  WaitlistRepository,
} from '../repos/WaitlistRepository';

const HOUR = 60 * 60 * 1000;

const REGIME = { '1': 'other', '2': 'mei', '3': 'simples' } as const;

// The public guide has no session: each route checks its own origin, content type, and rate.
export function guideRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: Config; cnpjDispatcher?: Dispatcher },
): void {
  const waitlist = new WaitlistRepository(deps.db);
  const cnpjLimit = createRateLimiter({ windowMs: HOUR, max: 30 });
  // One cap for every visitor: onboarding shares the BrasilAPI quota and must keep working.
  const cnpjGlobalLimit = createRateLimiter({ windowMs: HOUR, max: 300 });
  const waitlistLimit = createRateLimiter({ windowMs: HOUR, max: 10 });

  app.get<{ Params: { cnpj: string } }>('/api/public/cnpj-regime/:cnpj', async (request) => {
    if (!cnpjLimit(visitorIp(request))) throw new HttpError(429, 'too_many_requests');
    const cnpj = request.params.cnpj.replace(/[.\-/\s]/g, '').toUpperCase();
    if (!isValidCnpj(cnpj)) throw new HttpError(400, 'invalid_cnpj');
    if (!cnpjGlobalLimit('all')) throw new HttpError(503, 'cnpj_lookup_unavailable');
    try {
      const draft = await lookupCnpj(
        cnpj,
        deps.cnpjDispatcher ? { dispatcher: deps.cnpjDispatcher } : {},
      );
      return { regime: REGIME[draft.simplesNacional] };
    } catch (error) {
      if (!(error instanceof LookupError)) throw error;
      // A company that is not active is not in the Simples, whatever its old option.
      if (error.code === 'cnpj_not_active') return { regime: 'inactive' as const };
      throw new HttpError(error.code === 'cnpj_not_found' ? 404 : 503, error.code);
    }
  });

  app.post<{
    Body: {
      email: string;
      interests: WaitlistInterest[];
      sourcePage: string;
      campaign?: string;
      turnstileToken?: string;
    };
  }>(
    '/api/public/waitlist',
    {
      // Before body validation, so a foreign origin or a plain-text body is not told about the schema.
      preValidation: async (request) => {
        if (request.headers.origin !== deps.config.appOrigin)
          throw new HttpError(403, 'bad_origin');
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
          throw new HttpError(415, 'json_required');
        }
      },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'interests', 'sourcePage'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            interests: {
              type: 'array',
              minItems: 1,
              maxItems: WAITLIST_INTERESTS.length,
              items: { enum: [...WAITLIST_INTERESTS] },
            },
            sourcePage: { type: 'string', minLength: 1, maxLength: 200 },
            campaign: { type: 'string', maxLength: 200 },
            turnstileToken: { type: 'string', maxLength: 4096 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!waitlistLimit(visitorIp(request))) throw new HttpError(429, 'too_many_requests');
      const { turnstile } = deps.config;
      if (turnstile) {
        const token = request.body.turnstileToken;
        if (!token || !(await verifyTurnstile(turnstile.secretKey, token, visitorIp(request)))) {
          throw new HttpError(403, 'captcha_failed');
        }
      }
      waitlist.signUp({
        email: request.body.email,
        interests: request.body.interests,
        sourcePage: request.body.sourcePage,
        campaign: request.body.campaign ?? null,
      });
      return reply.status(204).send();
    },
  );
}
