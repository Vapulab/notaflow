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

export const loggerOptions = {
  serializers: { req: requestForLog, err: redactError },
  redact: { paths: REDACT_PATHS, censor: REDACTED },
  hooks: {
    logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void) {
      method.apply(this, redactLogArgs(args));
    },
  },
};

// A library's extra log argument as one line: an Error keeps its message and stack, an object its JSON.
export function argForLog(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return JSON.stringify(redactError(arg));
  // A class instance can hold fields the rules never read: only its type goes out.
  if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
    const proto: unknown = Object.getPrototypeOf(arg);
    if (proto !== Object.prototype && proto !== null) {
      return `[Object ${(arg as { constructor?: { name?: string } }).constructor?.name ?? 'Object'}]`;
    }
  }
  try {
    return JSON.stringify(redactValue(arg)) ?? String(arg);
  } catch {
    return '[unserializable]';
  }
}
