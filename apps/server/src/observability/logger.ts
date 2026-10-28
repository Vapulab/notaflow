import { REDACT_PATHS, REDACTED, redactError, redactText, redactUrl, redactValue } from './redact';

interface LoggedRequest {
  method: string;
  url: string;
  host: string;
  ip: string;
  socket: { remotePort?: number | undefined };
}

// Fastify's request fields, with the URL through the redaction rules and no headers.
export function requestForLog(request: LoggedRequest) {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort ?? 0,
  };
}

// pino's arguments: (message), (object, message), or (error, message?), each with format arguments.
export function redactLogArgs(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  // pino takes the message of a lone error from error.message, past this hook.
  if (first instanceof Error) {
    return rest.length > 0
      ? [{ err: first }, ...rest.map((arg) => redactValue(arg))]
      : [{ err: first }, redactText(first.message)];
  }
  return args.map((arg) => redactValue(arg));
}

const FALLBACK = '[log redaction failed]';

// Logging must never throw: a rule that fails leaves a fixed text, not a raw value.
function safe<A extends unknown[], R>(fn: (...args: A) => R, fallback: R): (...args: A) => R {
  return (...args) => {
    try {
      return fn(...args);
    } catch {
      return fallback;
    }
  };
}

export const loggerOptions = {
  serializers: {
    req: safe(requestForLog, {
      method: FALLBACK,
      url: FALLBACK,
      host: FALLBACK,
      remoteAddress: FALLBACK,
      remotePort: 0,
    }),
    // pino hands this serializer any value logged under `err`, whatever its type says.
    err: safe((error: Error) => redactError(error), {
      type: 'Error',
      message: FALLBACK,
      stack: '',
    }),
  },
  redact: { paths: REDACT_PATHS, censor: REDACTED },
  hooks: {
    logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void) {
      try {
        method.apply(this, redactLogArgs(args));
      } catch {
        try {
          method.call(this, FALLBACK);
        } catch {
          // Nothing left to try: the log line is lost, the caller goes on.
        }
      }
    },
  },
};

// A library's extra log argument as one line: an Error keeps its message and stack, an object its JSON.
export function argForLog(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    if (arg instanceof Error) return JSON.stringify(redactError(arg));
    // A class instance can hold fields the rules never read: only its type goes out.
    if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      const proto: unknown = Object.getPrototypeOf(arg);
      if (proto !== Object.prototype && proto !== null) {
        return `[Object ${(arg as { constructor?: { name?: string } }).constructor?.name ?? 'Object'}]`;
      }
    }
    return JSON.stringify(redactValue(arg)) ?? String(arg);
  } catch {
    return '[unserializable]';
  }
}
