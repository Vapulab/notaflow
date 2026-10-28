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
// The exact names, then the parts that mark a secret anywhere in a name (pfxBase64, passwordCiphertext).
const SECRET_KEY =
  /^(token|certificate|authorization|cookie|set-cookie|x-hub-signature-256|otp)$|password|passwd|senha|passphrase|secret|pfx|p12|privatekey|private_key|masterkey|master_key|apikey|api_key|ciphertext|wrappedkey|wrapped_key/i;

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

// Every regex below runs on at most this many characters, so a long attacker path costs linear time.
export const MAX_TEXT = 2048;
export const MAX_STACK = 8192;
const TRUNCATED = ' …[truncado]';

// A run without spaces or quotes; its first "/" or "http" before a "?" starts a URL.
const WORD = /[^\s"'<>]+/g;
const SECRET_PAIR =
  /\b(token|secret|password|senha|key|signature|sig|apikey|api_key|access_token|refresh_token)=[^&\s"'<>]+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// A private key in free text, also one the truncation cut before its END line.
const PEM_KEY =
  /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[A-Za-z0-9+/=\s]*(?:-----END [A-Z ]*PRIVATE KEY-----)?/g;
// Any <token>@<token> run; it starts only at a token boundary, so each run is read once.
const EMAIL = /(?<![^\s@<>(),;:"'=&?/])[^\s@<>(),;:"'=&?/]+@([^\s@<>(),;:"'=&?/]+)/g;
const HOST = /^(?:[A-Za-z0-9-]{1,63}\.){0,8}[A-Za-z0-9-]{1,63}$/;
// A package path in a stack ("node_modules/fastify@5.12.5/") is not an address: npm name and whole semver.
const PACKAGE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const JSON_SECRET =
  /"(token|secret|password|passwd|apiKey|api_key|key|signature|authorization|cookie|access_token|refresh_token|id_token|pfx|masterKey|master_key|certificate|privateKey|private_key)"\s*:\s*("[^"]*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/gi;
// A CPF (11 digits) or a CNPJ (14 characters [0-9A-Z] that end in two digits), with or without punctuation.
const DOCUMENT =
  /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2})\b/g;

// Logs keep the e-mail domain; Sentry keeps no part of an e-mail or a document (the privacy policy).
export type PersonalMode = 'log' | 'sentry';

export interface RedactOptions {
  personal?: PersonalMode;
  max?: number;
}

const DELIMITER = /[\s"'<>(),;/?&=#:]/;

const DOCUMENT_CHAR = /[0-9A-Z./-]/;

// The cut goes back past any partial word and document: a half e-mail or CPF would no longer match its rule.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  while (end > 0 && !DELIMITER.test(text.charAt(end - 1))) end -= 1;
  while (end > 0 && DOCUMENT_CHAR.test(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end) + TRUNCATED;
}

function redactPaths(text: string): string {
  return SECRET_PATHS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

function maskEmail(match: string, domain: string, mode: PersonalMode): string {
  // The run takes the punctuation after the address ("a@b.com!"); it stays in the text.
  let end = domain.length;
  while (end > 0 && !/[A-Za-z0-9]/.test(domain.charAt(end - 1))) end -= 1;
  const host = domain.slice(0, end);
  const suffix = domain.slice(end);
  const local = match.slice(0, match.length - domain.length - 1);
  if (host.length <= 253 && SEMVER.test(host) && PACKAGE.test(local)) return match;
  if (mode === 'sentry') return `[e-mail]${suffix}`;
  return `${REDACTED}@${host.length <= 253 && HOST.test(host) ? host : REDACTED}${suffix}`;
}

export function redactPersonal(text: string, mode: PersonalMode): string {
  const masked = text.replace(EMAIL, (match, domain: string) => maskEmail(match, domain, mode));
  return masked.replace(DOCUMENT, mode === 'sentry' ? '[documento]' : REDACTED);
}

function paramName(pair: string): string {
  const name = pair.split('=')[0] ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function cleanUrl(url: string, allow: ReadonlySet<string>, mode: PersonalMode): string {
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
  const query = kept.length > 0 ? `?${redactPersonal(kept.join('&'), mode)}` : '';
  return redactPersonal(redactPaths(path), mode) + query;
}

// A URL or a path: secret segments get a placeholder, and only allowed query parameters stay.
export function redactUrl(
  url: string,
  allow: ReadonlySet<string> = QUERY_ALLOW,
  options: RedactOptions = {},
): string {
  return cleanUrl(truncate(url, options.max ?? MAX_TEXT), allow, options.personal ?? 'log');
}

function dropQueries(text: string): string {
  return text.replace(WORD, (word) => {
    const mark = word.indexOf('?');
    if (mark === -1) return word;
    const scheme = word.indexOf('http');
    const start = scheme !== -1 && scheme < mark ? scheme : word.indexOf('/');
    if (start === -1 || start > mark) return word;
    return word.slice(0, start) + cleanUrl(word.slice(start), QUERY_ALLOW, 'log');
  });
}

// Free text: a log message, an error message or stack, an audit detail.
export function redactText(text: string, options: RedactOptions = {}): string {
  return redactPersonal(
    redactPaths(dropQueries(truncate(text, options.max ?? MAX_TEXT)))
      .replace(SECRET_PAIR, `$1=${REDACTED}`)
      .replace(BEARER, `$1 ${REDACTED}`)
      .replace(PEM_KEY, `-----BEGIN $1PRIVATE KEY-----${REDACTED}`)
      .replace(JSON_SECRET, `"$1":"${REDACTED}"`),
    options.personal ?? 'log',
  );
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Keys whose value pino's own serializers read: a request, a response, an error.
const SERIALIZED_KEY = new Set(['req', 'res', 'err']);

// A class instance can hold fields the rules never read: only its type goes out.
function instanceName(value: object): string {
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return `[Object ${typeof name === 'string' && name ? name : 'Object'}]`;
}

// Strings anywhere in plain objects and arrays; under req, res, and err the serializer takes the value as it is.
export function redactValue(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value, options);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options, depth + 1));
  if (value instanceof Error) return redactKnownError(value, depth);
  if (!isPlainObject(value)) return instanceName(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key)
        ? REDACTED
        : SERIALIZED_KEY.has(key) && typeof item === 'object' && item !== null
          ? item
          : redactValue(item, options, depth + 1),
    ]),
  );
}

export interface RedactedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

// A cause chain can loop back to its own error, so the depth stops it.
function redactItem(item: unknown, depth: number): unknown {
  if (!(item instanceof Error)) return redactValue(item, {}, 1);
  return depth < 3 ? redactKnownError(item, depth + 1) : `[${item.name}]`;
}

// The serializer of `err` gets any value a caller logs; only an Error has a message and a stack.
export function redactError(error: Error, depth?: number): RedactedError;
export function redactError(error: unknown, depth?: number): unknown;
export function redactError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return redactValue(error);
  return redactKnownError(error, depth);
}

function redactKnownError(error: Error, depth = 0): RedactedError {
  const out: RedactedError = {
    type: typeof error.name === 'string' ? error.name : 'Error',
    message: typeof error.message === 'string' ? redactText(error.message) : '',
    stack: typeof error.stack === 'string' ? redactText(error.stack, { max: MAX_STACK }) : '',
  };
  for (const [key, item] of Object.entries(error)) {
    if (key !== 'cause') out[key] = SECRET_KEY.test(key) ? REDACTED : redactItem(item, depth);
  }
  if (error.cause !== undefined) out.cause = redactItem(error.cause, depth);
  return out;
}
