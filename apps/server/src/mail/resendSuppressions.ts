import { type Dispatcher, request } from 'undici';

// 'complaint': Resend holds the address for a spam complaint, so it stays blocked.
export type Unsuppress = (address: string) => Promise<'removed' | 'complaint'>;

// Takes an address off Resend's own suppression list, which would otherwise drop the next send to it.
export function resendUnsuppress(options: { apiKey: string; dispatcher?: Dispatcher }): Unsuppress {
  const call = (method: 'GET' | 'DELETE', address: string) =>
    request(`https://api.resend.com/suppressions/${encodeURIComponent(address)}`, {
      method,
      headers: { authorization: `Bearer ${options.apiKey}` },
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
    });
  const fail = (status: number) => new Error(`Resend answered ${status}`);
  return async (address) => {
    // Resend's list is per team: a complaint may be there with no row of ours to tell us so.
    const found = await call('GET', address);
    if (found.statusCode === 404) {
      await found.body.dump();
      return 'removed';
    }
    if (found.statusCode < 200 || found.statusCode >= 300) {
      await found.body.dump();
      throw fail(found.statusCode);
    }
    const { origin } = (await found.body.json()) as { origin?: unknown };
    if (origin === 'complaint') return 'complaint';
    const removed = await call('DELETE', address);
    await removed.body.dump();
    // A 404 means Resend no longer holds the address, which is the state we want.
    if (removed.statusCode === 404) return 'removed';
    if (removed.statusCode < 200 || removed.statusCode >= 300) throw fail(removed.statusCode);
    return 'removed';
  };
}

// Safe to log: only our own status-only message, else the error class, since an undici error can carry the URL with the address.
export function unsuppressFailure(error: unknown): string {
  if (error instanceof Error && /^Resend answered \d{3}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : typeof error;
}
