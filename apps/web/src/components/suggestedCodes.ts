import { api, type ServiceCode } from '../api';
import { useAsync } from './useAsync';

export const SUGGESTED_HEADING = 'Sugeridos pelas atividades (CNAE) da empresa';

// The codes the emitter's CNAEs suggest (NotaFlow's own table): listed before any typing, and first
// among the matches of a search. A failure only means no suggestions.
export function useSuggestedCodes(base: string, emitterId: string) {
  const suggested = useAsync(
    () =>
      emitterId
        ? api
            .get<{ codes: ServiceCode[] }>(
              `${base}/emitters/${encodeURIComponent(emitterId)}/service-codes/suggested`,
            )
            .then((answer) => answer.codes)
        : Promise.resolve<ServiceCode[]>([]),
    [base, emitterId],
  );
  const codes = suggested.data ?? [];
  const groups = new Set(codes.map((c) => c.code.slice(0, 2)));
  return {
    codes,
    // With text typed: the search results, with the suggested groups first.
    rank: (found: ServiceCode[]) =>
      [...found].sort(
        (a, b) => Number(groups.has(b.code.slice(0, 2))) - Number(groups.has(a.code.slice(0, 2))),
      ),
  };
}
