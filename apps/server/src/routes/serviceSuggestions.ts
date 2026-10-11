import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { accountContext } from '../auth/guards';
import { suggestedServiceCodes } from '../data/cnaeServices';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { lookupCnpj } from '../onboarding/cnpjLookup';
import { EmitterRepository } from '../repos/EmitterRepository';

// The service codes the emitter's CNAEs suggest; they go on top of the search, never instead of it.
export function serviceSuggestionRoutes(
  app: FastifyInstance,
  deps: { db: Database; cnpjDispatcher?: Dispatcher },
): void {
  const emitters = new EmitterRepository(deps.db);

  app.get<{ Params: { accountId: string; emitterId: string } }>(
    '/api/accounts/:accountId/emitters/:emitterId/service-codes/suggested',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { emitterId } = request.params;
      let cnaes = emitters.cnaesOf(ctx, emitterId);
      if (cnaes === undefined) throw new HttpError(404, 'not_found');
      // An emitter from before onboarding read its card: the public lookup gives its CNAEs once.
      if (cnaes === null) {
        const emitter = emitters.get(ctx, emitterId);
        try {
          const draft = await lookupCnpj(
            emitter?.cnpj ?? '',
            deps.cnpjDispatcher ? { dispatcher: deps.cnpjDispatcher } : {},
          );
          cnaes = [...(draft.cnae ? [draft.cnae] : []), ...draft.secondaryCnaes];
          emitters.setCnaes(ctx, emitterId, cnaes);
        } catch {
          // No suggestions this time; the search still works, and the next visit tries again.
          return { cnaes: [], codes: [] };
        }
      }
      return { cnaes, codes: suggestedServiceCodes(cnaes) };
    },
  );
}
