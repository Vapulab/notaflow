# RFC: Bug Reports

**Status:** Approved in design (2026-10-21); implemented on `feat/bug-report`
**Date:** 2026-10-21
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [Monitoring RFC](RFC_MONITORING.md) (metrics, alerts, and the Grafana panels)
- [Lifecycle E-mails RFC](RFC_LIFECYCLE_EMAILS.md) (the mail outbox that the deliveries copy)
- [Data](../../../CONVENTIONS/DATA.md) and [Secrets](../../../CONVENTIONS/SECRETS.md)
- GitHub REST API, issues: <https://docs.github.com/en/rest/issues/issues>
- GitHub webhooks, signature check: <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- Notion API, create a page: <https://developers.notion.com/reference/post-page>

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution](#solution)
4. [Design](#design)
5. [Privacy](#privacy)
6. [Data Model](#data-model)
7. [Configuration](#configuration)
8. [Metrics and Alerts](#metrics-and-alerts)
9. [File Locations](#file-locations)
10. [Testing](#testing)

---

## Overview

A customer reports a bug from any screen of an account with the "Reportar bug" button. The server stores the report and answers at once. Then it sends the report to three channels: a GitHub issue of type Bug in the public repository `Vapulab/notaflow`, a card in the Notion bugs database, and a message in the private Discord channel. When the issue closes on GitHub, a webhook marks the report as resolved, moves the Notion card to `Resolvido`, and tells Discord.

---

## Problem Statement

- **No channel in the app.** A customer who finds a bug must write an e-mail or a WhatsApp message. Many do not.
- **No context.** A report by e-mail rarely says the screen or the browser.
- **No single list.** Bugs live in e-mail, chat, and memory. Nobody can count the open ones.

---

## Solution

| Decision | Choice | Why |
| --- | --- | --- |
| Who can report | Any member of the account, also of a suspended account | A bug can be the reason why an account cannot work. |
| Where the work lives | A GitHub issue of type Bug, label `bug` | The fix and the PR live in the same repository. |
| Where the triage lives | A Notion card | The Notion database holds the customer, the severity, and the checklist that GitHub must not show. |
| Who hears first | A Discord message | The team already reads the alert channel. |
| Delivery | Store first, then send with retries, as the mail outbox does | An outage of GitHub, Notion, or Discord delays a report. It never loses one. |
| Resolution | The GitHub issues webhook | Closing the issue is the one action the developer already does. |
| Abuse limit | 5 reports per person per hour | A report creates work in three systems. |

---

## Design

### The flow

1. The dialog posts `POST /api/accounts/:accountId/bug-reports` with `{ title, description, pagePath }`. `pagePath` is `window.location.pathname`.
2. The route checks the membership (no owner role, no write check), the lengths, and the limit. It reads the user agent from the request header.
3. One transaction inserts the `bug_reports` row and one `bug_report_deliveries` row per configured channel. The audit log records `bug.report`.
4. The route answers `201 { id }`. The first delivery attempt starts after the answer. Its failure never changes the answer.
5. The scheduler runs `BugReports.deliverDue()` every 30 seconds, as it does for the mail outbox.

### Deliveries

Each delivery row has a kind:

| Kind | Sends | Waits for |
| --- | --- | --- |
| `github_issue` | `POST /repos/{owner}/{repo}/issues` with `type: 'Bug'` and `labels: ['bug']`; stores the number and the URL | Nothing |
| `notion_page` | `POST /v1/pages` in the bugs database; stores the page id and the URL | `github_issue`, so the card has the issue link |
| `discord_report` | A webhook message with an embed | `github_issue` and `notion_page`, so the message has both links |
| `notion_status` | `PATCH /v1/pages/:id` with the new `Status` | `notion_page`, because it needs the page id |
| `discord_status` | "Resolvido: title" or "Reaberto: title", with the issue link | Nothing |

- A delivery waits for the GitHub link for at most 10 minutes after it was queued. After that it goes without the link.
- The retry rules are the rules of the mail outbox: a new attempt after 1, 5, 30, and 120 minutes. The 5th failure is final (`failed`). The last error is kept, cut to 500 characters.
- A row in `sending` for more than 5 minutes is from a process that stopped. The next run sets it back to `pending`.
- A run claims a row with a conditional `UPDATE` first, so two runs never send the same row. The claim stores the real claim time, which the reset of stuck rows (5 minutes) reads.
- A `github_issue` or `notion_page` retry checks the stored number or page id first. Then it looks for the report id: in the 100 newest `bug` issues of the repository (the issue body names the report), or in the `ID NotaFlow` property of the Notion database. A create whose answer was lost is found, not repeated.
- A `notion_status` sends the current status of the report, so a late retry cannot undo a later change. A report with no Notion page skips it.
- The Discord message sets `allowed_mentions: { parse: [] }`, so a text that contains `@everyone` pings nobody.
- Each HTTP call has a timeout of 15 seconds.

### The GitHub webhook

`POST /webhooks/github` is outside `/api`, so the auth hook does not apply. It works like the unsubscribe route: an encapsulated Fastify scope that keeps the raw body.

1. Without `GITHUB_WEBHOOK_SECRET`, the route answers 404.
2. It computes the HMAC SHA-256 of the raw body with the secret and compares it with `x-hub-signature-256` with `timingSafeEqual`. A mismatch is 401.
3. A `ping`, any event that is not `issues`, any action that is not `closed` or `reopened`, an event from another repository, or an unknown issue answers 204 and changes nothing.
4. `closed` sets the report to `closed` with `closed_at`. `reopened` sets it to `open` and clears `closed_at`. Each queues `notion_status` (`Resolvido` or `Em análise`) and `discord_status`. The audit log records `bug.resolve` or `bug.reopen` as the user `github`.
5. GitHub sends an event again after a timeout. The same status twice changes nothing and queues nothing.

The lookup by issue URL reads across accounts. This is system scope, like the metrics and the delivery worker: GitHub acts for no account. The URL names the repository, so an issue with the same number in another repository (after `GITHUB_BUG_REPO` changes) never touches a report.

---

## Privacy

The repository is public. The GitHub issue gets only:

- the title and the description, through `maskPersonalData`;
- the screen path, through `maskPath`;
- the NotaFlow report id.

It never gets the account name, the user name, or the e-mail.

`maskPersonalData` replaces, in this order:

| Data | Example | Becomes |
| --- | --- | --- |
| E-mail | `ana@example.com` | `[e-mail]` |
| CNPJ with punctuation, numeric or alphanumeric | `12.345.678/0001-95`, `12.ABC.345/01DE-35` | `[CNPJ]` |
| CPF with punctuation | `123.456.789-09` | `[CPF]` |
| CNPJ without punctuation, numeric or alphanumeric | `12345678000195`, `12ABC34501DE35` | `[CNPJ]` |
| Phone, with or without +55 and the area code | `(43) 99999-8888`, `43 3322-1100` | `[telefone]` |
| Any other run of 8 or more digits (a CPF without punctuation, an access key) | `12345678909` | `[número]` |

The server stores the path without the query string and the fragment, and stores `/` when the path has a character outside a plain URL path (a backtick, a space, an `@`). `maskPath` keeps only the literal route words of the app (`app`, `notas`, `clientes`, and the others in `apps/web/src/router.ts`) and replaces every other segment with `:id`, so a name or an e-mail in a URL cannot reach the issue. The dialog tells the user that the title and the description become a public issue. The issue body also puts a zero-width space after each `@`, so the customer's text cannot mention a GitHub user.

The Discord channel and the Notion database are private. Discord gets the account name and a masked excerpt of at most 300 characters. Notion gets the full text, the account name, the user e-mail, and the full screen URL, because the triage needs them.

---

## Data Model

`bug_reports` is a business table: soft delete only, with the `bug_reports_no_delete` trigger.

| Column | Note |
| --- | --- |
| `account_id` | The account of the report |
| `created_by` | The user who reported it (the control column) |
| `title`, `description` | At most 120 and 4000 characters |
| `page_path` | The route path only, at most 300 characters |
| `user_agent` | From the request header, at most 300 characters |
| `status`, `closed_at` | `open` or `closed`; set by the webhook |
| `github_issue_number`, `github_issue_url` | Set by the `github_issue` delivery |
| `notion_page_id`, `notion_page_url` | Set by the `notion_page` delivery |

`bug_report_deliveries` has the shape of `mail_outbox`: `kind`, `report_status` (for the status kinds), `status` (`pending`, `sending`, `sent`, `failed`), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `sent_at`. It is a work queue, not a business table, like `mail_outbox`.

---

## Configuration

Every variable is optional. A channel is off while its variables are unset, so development and tests need none. A channel that is off gets no delivery rows.

| Variable | Use |
| --- | --- |
| `GITHUB_BUG_TOKEN`, `GITHUB_BUG_REPO` | Both or neither. A fine-grained token with Issues read and write; the repository as `owner/name` |
| `GITHUB_WEBHOOK_SECRET` | The secret of the issues webhook. Without it, `/webhooks/github` answers 404 |
| `DISCORD_BUG_WEBHOOK_URL` | An `https` URL |
| `NOTION_TOKEN`, `NOTION_BUGS_DATABASE_ID` | Both or neither. Share the database with the integration |

The Notion database must have these properties with these exact names: `Título`, `Status` (select: Novo, Em análise, Corrigindo, Resolvido, Não é bug), `Severidade`, `Origem` (select: App, WhatsApp, E-mail, Interno), `Cliente`, `Emitente`, `Reportado por`, `Tela`, `Issue`, `Reportado em`, `ID NotaFlow`. The app fills all but `Severidade` and `Emitente`.

---

## Metrics and Alerts

| Metric | Labels |
| --- | --- |
| `notaflow_bug_reports` | `status`: `open` (active), `closed` (resolved) |
| `notaflow_bug_report_deliveries` | `channel`: `github`, `discord`, `notion`; `state`: `pending` (also `sending`), `failed` |

Both gauges read the database at scrape time. A `failed` delivery counts for 7 days, so the alert `BugDeliveriesFailed` clears by itself. The Grafana dashboard `6. Bugs` (uid `bugs`) shows the reported, active, and resolved totals, the open and closed lines, and the deliveries by channel.

A failed delivery has no retry button yet. To send it again, set its `status` to `pending` and `attempts` to 0 in the database.

---

## File Locations

| File | Content |
| --- | --- |
| `apps/server/src/bugs/BugReports.ts` | The service: report, webhook status change, delivery worker |
| `apps/server/src/bugs/channels.ts` | The GitHub, Discord, and Notion clients (undici) |
| `apps/server/src/bugs/mask.ts` | `maskPersonalData` and `maskPath` |
| `apps/server/src/bugs/githubWebhook.ts` | `POST /webhooks/github` |
| `apps/server/src/routes/bugReports.ts` | `POST /api/accounts/:accountId/bug-reports` |
| `apps/server/src/repos/BugReportRepository.ts` | The queries on `bug_reports` |
| `apps/web/src/components/BugReportDialog.tsx` | The dialog behind "Reportar bug" |
| `deploy/monitoring/grafana/dashboards/6-bugs.json` | The Grafana dashboard |

---

## Testing

- `mask.test.ts`: each masked format, texts that must not change, and the paths.
- `bugReports.test.ts`: the three channels through an undici `MockAgent` (the masked issue, the Notion properties, the Discord links); no channel configured; a suspended account; a GitHub failure and the retry; a retry that finds the issue of a lost answer; a path with markdown stored as `/`; 5 failures to `failed`; the rate limit; the validation; the webhook signature, events, repository, idempotency, close and reopen; the gauges.
- `BugReportDialog.test.tsx`: the button only inside an account, the request body, the thanks text, and the error text.
- `rules.test.yml`: `BugDeliveriesFailed` fires on a failed delivery only.
