import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';

export interface RequestInfo {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

// Set once per request, so the audit log knows where a change came from without every call site passing it.
export const requestContext = new AsyncLocalStorage<RequestInfo>();

const PRIVATE = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^::1$/,
  /^f[cd]/i,
];

// The tunnel reaches the app from the private Docker network; only then is Cloudflare's header trusted.
export function clientIp(remoteAddress: string, cfConnectingIp: string | undefined): string {
  const remote = remoteAddress.replace(/^::ffff:/, '');
  const behindTunnel = PRIVATE.some((range) => range.test(remote));
  if (behindTunnel && cfConnectingIp && isIP(cfConnectingIp)) return cfConnectingIp;
  return remote;
}
