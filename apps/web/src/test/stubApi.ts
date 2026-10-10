import { vi } from 'vitest';

// HTTP status the server uses for each error code these tests send back.
const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  ptax_unavailable: 502,
  sefin_unavailable: 502,
  sefin_rejected: 422,
  invalid_amount: 400,
  danfse_unavailable: 503,
  amount_ptax_mismatch: 400,
  http_502: 502,
  http_524: 524,
};

export interface StubCall {
  url: string;
  init?: RequestInit;
}

// Answers by the longest matching URL prefix; a body with an `error` field is an error answer.
export function stubApi(routes: Record<string, unknown>): StubCall[] {
  const calls: StubCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      const key = Object.keys(routes)
        .filter((prefix) => url.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
      const body = key ? routes[key] : { error: 'not_found' };
      const error =
        typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : null;
      return new Response(JSON.stringify(body), {
        status: error ? (ERROR_STATUS[error] ?? 400) : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
