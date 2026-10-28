import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TrustedPeer } from '../trustedPeer';
import type { Metrics } from './metrics';

// A listener apart from the app: the tunnel reaches only the app port, so /metrics is never public.
export async function startMetricsServer(
  metrics: Metrics,
  options: { host: string; port: number; allow?: TrustedPeer },
): Promise<{ port: number; close: () => Promise<void> }> {
  const { allow } = options;
  const server = createServer(async (request, response) => {
    await allow?.ready;
    // Other projects' containers share the Docker network, so the port alone does not keep /metrics private.
    const allowed = !allow || allow.has(request.socket.remoteAddress ?? '');
    if (!allowed || request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    metrics.render().then(
      (text) => {
        response.writeHead(200, { 'content-type': metrics.registry.contentType }).end(text);
      },
      () => response.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
