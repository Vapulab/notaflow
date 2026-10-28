import * as Sentry from '@sentry/node';
import { HttpError } from '../httpError';

export interface ErrorReporter {
  capture(error: unknown, context: { module: string; requestId?: string }): void;
}

export const noErrorReporter: ErrorReporter = { capture() {} };

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
  return text.replace(EMAIL, '[e-mail]').replace(DOCUMENT, '[documento]');
}

// No personal data leaves for Sentry: no body, cookie, header, query, IP, e-mail, or document.
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const clean: ScrubbableEvent = { ...event };
  if (clean.message) clean.message = scrubText(clean.message);
  if (clean.request) {
    const url = clean.request.url?.split('?')[0];
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

export function statusOf(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : 500;
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

export function sentryReporter(options: {
  dsn: string;
  release: string | undefined;
  environment: string;
}): ErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    ...(options.release ? { release: options.release } : {}),
    environment: options.environment,
    dataCollection: NO_DATA,
    // Only what the app reports, plus crashes: no automatic HTTP or database instrumentation.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
    ],
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: () => null,
  });
  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        scope.setTag('module', context.module);
        if (context.requestId) scope.setTag('request_id', context.requestId);
        Sentry.captureException(error);
      });
    },
  };
}
