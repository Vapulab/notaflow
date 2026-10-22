import { request } from 'undici';

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  try {
    const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
      signal: AbortSignal.timeout(5000),
    });
    const body: unknown = await response.body.json();
    return (body as { success?: unknown }).success === true;
  } catch {
    // Cloudflare is unreachable: refuse, and the visitor tries again.
    return false;
  }
}
