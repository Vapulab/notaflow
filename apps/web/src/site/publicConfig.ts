import type { ErrorTrackingConfig } from '../observability/errors';

export interface PublicConfig {
  posthog?: { token: string; host: string } | null;
  sentry?: ErrorTrackingConfig | null;
  turnstileSiteKey?: string | null;
}

let loading: Promise<PublicConfig | null> | null = null;

// One request per page: the analytics start and the notify-me form share it.
export function publicConfig(): Promise<PublicConfig | null> {
  loading ??= fetch('/api/public/config')
    .then((response) => (response.ok ? (response.json() as Promise<PublicConfig>) : null))
    .catch(() => null);
  return loading;
}

// For tests: forget the cached answer.
export function resetPublicConfig(): void {
  loading = null;
}
