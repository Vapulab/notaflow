// The one place for the rules that keep secrets and personal data out of logs, audit details, and Sentry.
// See docs/ENGINEERING/CONVENTIONS/LOGGING.md before you add a route with a secret in its path or query.

export const REDACTED = '***';

// A path segment that is a bearer secret or a document, and the pattern that replaces it.
const SECRET_PATHS: [RegExp, string][] = [
  [/\/n\/[A-Za-z0-9_-]+/g, '/n/:token'],
  [/\/cnpj-regime\/[^/?#\s"'<>]+/g, '/cnpj-regime/:cnpj'],
  [/\/api\/webhooks\/(\d+)\/[A-Za-z0-9_-]+/g, '/api/webhooks/$1/:token'],
];

// Every other query parameter is dropped: auth codes, OAuth states, unsubscribe signatures, searches.
export const QUERY_ALLOW = new Set(['limit', 'offset', 'status', 'environment', 'archived']);

// Object keys whose value never reaches a log line, at any depth.
const SECRET_KEY =
  /^(password|senha|passphrase|token|secret|pfx|p12|certificate|masterkey|master_key|apikey|api_key|authorization|cookie|set-cookie|x-hub-signature-256|otp)$/i;

// pino's own redaction, for the paths it can reach before the function rules run.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  ...['password', 'token', 'secret', 'pfx', 'masterKey', 'apiKey'].flatMap((key) => [
    key,
    `*.${key}`,
  ]),
];

const URL_WITH_QUERY = /((?:https?:\/\/[^\s/?#"'<>]+)?\/[^\s?#"'<>]*)\?[^\s"'<>#]+/g;
const SECRET_PAIR =
  /\b(token|secret|password|senha|key|signature|sig|apikey|api_key|access_token|refresh_token)=[^&\s"'<>]+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// The local part stops at separators, so "to=a@b.com" keeps "to=".
const EMAIL = /[^\s@<>(),;:"'=&?/]+@([^\s@<>(),;:"'&?/]+\.[A-Za-z]{2,})/g;
// A CPF (11 digits) or a CNPJ (14 characters [0-9A-Z] that end in two digits), with or without punctuation.
const DOCUMENT =
  /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2})\b/g;

function redactPaths(text: string): string {
  return SECRET_PATHS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

function redactPersonal(text: string): string {
  return text.replace(EMAIL, `${REDACTED}@$1`).replace(DOCUMENT, REDACTED);
}

function paramName(pair: string): string {
  const name = pair.split('=')[0] ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// A URL or a path: secret segments get a placeholder, and only allowed query parameters stay.
export function redactUrl(url: string, allow: ReadonlySet<string> = QUERY_ALLOW): string {
  const noHash = url.split('#')[0] ?? '';
  const mark = noHash.indexOf('?');
  const path = mark === -1 ? noHash : noHash.slice(0, mark);
  const kept =
    mark === -1
      ? []
      : noHash
          .slice(mark + 1)
          .split('&')
          .filter((pair) => allow.has(paramName(pair)));
  const query = kept.length > 0 ? `?${redactPersonal(kept.join('&'))}` : '';
  return redactPersonal(redactPaths(path)) + query;
}

// Free text: a log message, an error message or stack, an audit detail.
export function redactText(text: string): string {
  return redactPersonal(
    redactPaths(text.replace(URL_WITH_QUERY, (match) => redactUrl(match)))
      .replace(SECRET_PAIR, `$1=${REDACTED}`)
      .replace(BEARER, `$1 ${REDACTED}`),
  );
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Strings anywhere in plain objects and arrays; an Error or a class instance (a request) goes to its serializer.
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED : redactValue(item, depth + 1),
    ]),
  );
}

export interface RedactedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

function redactItem(item: unknown, depth: number): unknown {
  return item instanceof Error ? redactError(item, depth + 1) : redactValue(item, 1);
}

export function redactError(error: Error, depth = 0): RedactedError {
  const out: RedactedError = {
    type: error.name,
    message: redactText(error.message),
    stack: redactText(error.stack ?? ''),
  };
  for (const [key, item] of Object.entries(error)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactItem(item, depth);
  }
  if (error.cause !== undefined && depth < 3) out.cause = redactItem(error.cause, depth);
  return out;
}
