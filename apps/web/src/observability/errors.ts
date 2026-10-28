import { redactLinkToken } from './linkToken';

export interface ErrorTrackingConfig {
  dsn: string;
  release: string | null;
  environment: string;
}

// The parts of a Sentry event this code reads or rewrites.
interface ScrubbableEvent {
  message?: string | undefined;
  request?: { url?: string | undefined } | undefined;
  user?: { id?: string | number | undefined } | undefined;
  exception?: { values?: { value?: string | undefined }[] | undefined } | undefined;
  breadcrumbs?: unknown;
}

// The domain ends in letters, so a comma or period after the address stays in the text.
const EMAIL = /[^\s@<>(),;]+@[^\s@<>(),;]+\.[A-Za-z]{2,}/g;
// A CPF or CNPJ, with or without punctuation, numeric or alphanumeric.
const DOCUMENT =
  /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2})\b/g;

function scrubText(text: string): string {
  return redactLinkToken(text).replace(EMAIL, '[e-mail]').replace(DOCUMENT, '[documento]');
}

// The server's Sentry mode (apps/server/src/observability/redact.ts): no query, header, e-mail, document, or breadcrumb leaves.
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const clean: ScrubbableEvent = { ...event };
  if (clean.message) clean.message = scrubText(clean.message);
  if (clean.request) {
    const url = clean.request.url
      ? redactLinkToken(clean.request.url.split('?')[0] ?? '')
      : undefined;
    clean.request = url ? { url } : {};
  }
  if (clean.user) clean.user = clean.user.id === undefined ? {} : { id: clean.user.id };
  if (clean.exception?.values) {
    clean.exception = {
      ...clean.exception,
      values: clean.exception.values.map((value) => ({
        ...value,
        ...(value.value ? { value: scrubText(value.value) } : {}),
      })),
    };
  }
  delete clean.breadcrumbs;
  return clean as T;
}

// Sentry 11 collects users, cookies, headers, queries, and bodies unless told not to.
export const NO_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
};

let started = false;

// Loaded on demand, so the app does not wait for it and runs the same without it.
export async function startErrorTracking(config: ErrorTrackingConfig | null): Promise<void> {
  if (!config || started) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn: config.dsn,
      ...(config.release ? { release: config.release } : {}),
      environment: config.environment,
      dataCollection: NO_DATA,
      // Uncaught errors only: no fetch, click, or console instrumentation that could carry data.
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: () => null,
    });
    started = true;
  } catch {
    // A blocked or failed script never breaks the app.
  }
}

// For tests: forget the client between them.
export function stopErrorTracking(): void {
  started = false;
}
