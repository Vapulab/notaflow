# Logging

**No server log line, audit detail, or Sentry report keeps a secret or personal data.** One module holds every rule: `apps/server/src/observability/redact.ts`. Do not write a second scrubber. Add the rule there.

The server writes pino JSON to stdout. Alloy sends it to Loki (14 days), and Docker keeps its own JSON logs. A secret in a log line is a secret on the VM disk and in Loki.

## The rules

| Data | What the log keeps |
| --- | --- |
| A DANFSe link token in a path (`/n/<token>`, `/api/public/n/<token>`) | `/n/:token` |
| The CNPJ of the public regime lookup (`/api/public/cnpj-regime/<cnpj>`) | `/cnpj-regime/:cnpj` |
| A Discord webhook token in a URL | `/api/webhooks/<id>/:token` |
| A query string | Only the parameters in `QUERY_ALLOW` (`limit`, `offset`, `status`, `environment`, `archived`). Sentry keeps none. |
| An e-mail address (any `<word>@<word>` run, except a package version in a stack path) | Logs and audit details: `***@domain`, or `***@***` when the host is not a domain name. Sentry: `[e-mail]`, as the privacy policy promises. |
| A CPF (11 digits) or a CNPJ (14 characters `[0-9A-Z]`), with or without punctuation | Logs and audit details: `***`. Sentry: `[documento]`. |
| `token=`, `secret=`, `password=`, `key=`, `signature=` and similar pairs in text | `token=***` |
| `Bearer <value>` or `Basic <value>` | `Bearer ***` |
| An object key such as `password`, `token`, `secret`, `pfx`, `certificate`, `masterKey`, `apiKey`, `authorization`, `cookie`, at any depth | `***` |
| A request header | Never logged. pino's `redact` also covers `authorization`, `cookie`, `set-cookie`, and `x-hub-signature-256`. |
| A string longer than 2 KB (a stack: 8 KB) | Cut back to the last delimiter, past any partial word or document, with `…[truncado]` at the end, before any rule runs. This keeps the cost linear on a long attacker path. |
| An object deeper than 6 levels | `***` |

The log keeps the operational fields: method, route path, status, duration, request id, module, account id, invoice id, and error codes.

## Where the rules run

| Output | Wiring |
| --- | --- |
| Every pino line (`app.log`, `request.log`, `reply.log`) | `apps/server/src/observability/logger.ts`: the `req` and `err` serializers, pino `redact`, and a `logMethod` hook that redacts every message, format argument, and plain object |
| Better Auth's own messages | `libraryLog` in `createAuth`, so they go through pino and not straight to the console |
| Sentry | `scrubEvent` in `apps/server/src/observability/errors.ts`, with `{ personal: 'sentry' }`. The browser does the same in `apps/web/src/observability/errors.ts`. |
| The audit log | `AuditLog.record` redacts `detail`. The actor e-mail, IP, and user agent stay: the audit log needs them. |

## Add a route with a secret

1. If the secret is in the query, do nothing: the query is dropped. Do not add its name to `QUERY_ALLOW`.
2. If the secret is a path segment, add a pattern to `SECRET_PATHS` in `redact.ts`, with a placeholder such as `/:token`.
3. Add a case to `redact.test.ts` and a request to `logRedaction.test.ts`. The integration test fails if the value is in any log line.

## Do not

- Do not log a request body or a header. Log the ids you need.
- Do not log the certificate, its password, the master key, an API key, or a cookie, also not in a test.
- Do not use `console.log` in a request or a background job. It skips the rules. Only the command-line scripts (`seed.ts`, `backup.ts`) use the console.
- Do not change the rules for one call site. Change `redact.ts`, so every output gets the same rule.
