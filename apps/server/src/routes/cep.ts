import type { FastifyInstance } from 'fastify';
import type { Dispatcher } from 'undici';
import { accountContext } from '../auth/guards';
import { CepNotFoundError, fetchCep } from '../exchange/viaCep';
import { HttpError } from '../httpError';

export function cepRoutes(app: FastifyInstance, deps: { cepDispatcher?: Dispatcher }): void {
  app.get<{ Params: { accountId: string; cep: string } }>(
    '/api/accounts/:accountId/cep/:cep',
    async (request) => {
      accountContext(request, request.params.accountId);
      const { cep } = request.params;
      if (!/^\d{8}$/.test(cep)) throw new HttpError(400, 'invalid_cep');
      try {
        return await fetchCep({
          cep,
          ...(deps.cepDispatcher ? { dispatcher: deps.cepDispatcher } : {}),
        });
      } catch (error) {
        if (error instanceof CepNotFoundError) throw new HttpError(404, 'cep_not_found');
        request.log.warn({ err: error }, 'CEP lookup failed');
        throw new HttpError(502, 'cep_unavailable');
      }
    },
  );
}
