import { type Dispatcher, request } from 'undici';

export type Unsuppress = (address: string) => Promise<void>;

// Takes an address off Resend's own suppression list, which would otherwise drop the next send to it.
export function resendUnsuppress(options: { apiKey: string; dispatcher?: Dispatcher }): Unsuppress {
  return async (address) => {
    const response = await request(
      `https://api.resend.com/suppressions/${encodeURIComponent(address)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${options.apiKey}` },
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      },
    );
    await response.body.dump();
    // A 404 means Resend does not hold the address, which is the state we want.
    if (response.statusCode === 404) return;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Resend answered ${response.statusCode}`);
    }
  };
}

// Safe to log: only our own status-only message, else the error class, since an undici error can carry the URL with the address.
export function unsuppressFailure(error: unknown): string {
  if (error instanceof Error && /^Resend answered \d{3}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : typeof error;
}
