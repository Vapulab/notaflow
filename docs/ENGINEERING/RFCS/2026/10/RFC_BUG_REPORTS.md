# RFC: Bug Reports

**Status:** Approved in design (2026-10-21); implemented on `feat/bug-report`. Screenshots (issue #82) on `feat/bug-screenshots`
**Date:** 2026-10-21
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [Monitoring RFC](RFC_MONITORING.md) (metrics, alerts, and the Grafana panels)
- [Lifecycle E-mails RFC](RFC_LIFECYCLE_EMAILS.md) (the mail outbox that the deliveries copy)
- [Data](../../../CONVENTIONS/DATA.md) and [Secrets](../../../CONVENTIONS/SECRETS.md)
- GitHub REST API, issues: <https://docs.github.com/en/rest/issues/issues>
- GitHub webhooks, signature check: <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- Notion API, create a page: <https://developers.notion.com/reference/post-page>
- Cloudflare R2, S3 API compatibility: <https://developers.cloudflare.com/r2/api/s3/api/>
- AWS Signature Version 4: <https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html>

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution](#solution)
4. [Design](#design)
5. [Privacy](#privacy)
6. [Screenshots](#screenshots)
7. [Data Model](#data-model)
8. [Configuration](#configuration)
9. [Metrics and Alerts](#metrics-and-alerts)
10. [File Locations](#file-locations)
11. [Testing](#testing)

---

## Overview

A customer reports a bug from any screen of an account with the "Reportar bug" button. The server stores the report and answers at once. Then it sends the report to three channels: a GitHub issue of type Bug in the public repository `Vapulab/notaflow`, a card in the Notion bugs database, and a message in the private Discord channel. When the issue closes on GitHub, a webhook marks the report as resolved, moves the Notion card to `Resolvido`, and tells Discord.

A report can carry up to 3 screenshots. They go to a private Cloudflare R2 bucket, never to SQLite, GitHub, Notion, or Discord. A platform admin sees them on the admin page of the report. The server deletes them 30 days after the report is resolved. See [Screenshots](#screenshots).

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

## Screenshots

A customer attaches up to 3 images to a report. The team sees them on the admin page of the report. R2 deletes nothing by itself: the server deletes the images 30 days after the GitHub issue closes.

### The flow

1. The dialog takes PNG, JPEG, or WebP files from a file input, or from a paste (Ctrl+V) in the dialog.
2. `prepareBugImage` (`apps/web/src/components/bugImages.ts`) draws each file on a canvas at most 1920 px on the longer side and encodes it as WebP, quality 0.8. Safari has no WebP encoder: there it encodes JPEG. The new encoding drops the EXIF data, such as the GPS position of a phone photo. A result over 1 MB is refused with a message.
3. The dialog sends the images in the same JSON `POST`: `images: [{ contentType, data }]`, `data` in base64. The auth hook accepts only JSON for a `POST`, so there is no multipart upload. The route `bodyLimit` is 4.5 MB.
4. The route checks the count (at most 3), the type (`image/webp`, `image/png`, `image/jpeg`), the base64 alphabet, the size (1 MB after decoding), and the first bytes of the file against the type (`invalid_bug_image`).
5. Without R2, a report with images gets 400 `bug_images_unavailable`. A text-only report still works. `/api/public/config` gives `bugScreenshots: false`, and the dialog hides the picker.
6. The limit of 5 reports per hour also counts the reports of the same user that are still uploading. The service holds the slot before the first upload, so parallel requests cannot all pass the check.
7. The service sends each image to R2 as `bug-reports/<reportId>/<n>.<ext>` before any row exists. Then one transaction inserts the report, one `bug_report_images` row per image, and the deliveries.
8. If an upload fails, the request gets 502 `bug_images_failed`. If the transaction fails, the request gets 500. In both cases the service deletes every key of the report and stores no report. This includes a key whose `PUT` failed, because R2 may keep a `PUT` whose answer was lost. A 404 counts as deleted.

### What the channels get

| Channel | Gets |
| --- | --- |
| GitHub (public) | One line: "2 screenshots, visible to the NotaFlow team." No link, no key, no image |
| Notion (private) | A paragraph in "O que aconteceu": "2 imagens." and the link to the admin page. No new database property |
| Discord (private) | The fields `Imagens` ("2 imagens") and `Painel` (the admin page URL) |

Notion and Discord get the admin page link also for a report without images.

### The admin page

`/admin/bugs/:id` shows the title, the description, the account, the reporter, the screen path, the user agent, the status, the issue and Notion links, and the images. It reads:

- `GET /api/admin/bug-reports/:id`: the report and its image list (position, type, size, `purgedAt`). It never returns the R2 key.
- `GET /api/admin/bug-reports/:id/images/:position`: streams the object from R2 with `cache-control: private, no-store`.

Both routes need a platform admin (`adminContext`): any other user gets 403 `admin_only`. An unknown report or position, or a purged image, is 404. After the purge, the page says "As imagens foram apagadas em <date>".

### Retention and the purge

- An open report keeps its images.
- `BugReports.purgeImages()` deletes from R2 the images of each report that is `closed` with `closed_at` more than 30 days ago, then sets `purged_at`.
- A reopen sets the report to `open` and clears `closed_at`, so the purge skips it. A new close starts the 30 days again.
- Before each delete, the purge reads the report again: a webhook that reopens it during a run stops the deletes that are left.
- R2 answers 404 or 204 for a missing object: both count as deleted, so a run can repeat. A failed delete is logged and waits for the next run.
- The audit log records `bug.images_purge` per report as the user `system`.
- The purge depends on the GitHub webhook: only a closed issue closes a report. With GitHub off, or without `GITHUB_WEBHOOK_SECRET`, no report closes, and its images stay until someone closes it.
- A crash between the uploads and the database commit can leave objects that no row points to. The purge finds images only through rows, so it never removes them. A bucket lifecycle rule on the prefix `bug-reports/` (delete after 400 days) is the backstop. See [Deploy on the VM](../../../../TUTORIALS/DEPLOY_ON_VM.md#bug-report-screenshots).
- The scheduler in `main.ts` runs the purge every hour. The rule is daily, but a deploy restarts the process, so a 24-hour timer could never fire.

### The R2 client

`apps/server/src/bugs/r2.ts` calls the S3 API of R2 at `https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>`, region `auto`: `PUT`, `GET`, and `DELETE`. It signs with AWS Signature Version 4 in about 40 lines of `node:crypto`, so it adds no dependency. `aws4fetch` was the other choice: it is small, but it signs a `fetch` `Request`, and the other clients here use undici `request` with an injectable dispatcher. A test checks the signature against the GET Object example of the AWS documentation. Each call has a timeout of 15 seconds.

### Privacy

- The images can show the data of the customer's own clients. The privacy policy (section 3, 4, and 6) names what, why, where, who, and how long. The change was an update, with the notice `2026-10-21-bug-screenshots`, not a new acceptance.
- The bucket has no public access. Only the server has the token, scoped to the one bucket.
- The image bytes never enter SQLite, the backups, or a log.

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

`bug_report_images` is a business table too, with the `bug_report_images_no_delete` trigger:

| Column | Note |
| --- | --- |
| `bug_report_id`, `account_id` | The report and its account |
| `position` | 1 to 3, unique per report among active rows |
| `content_type`, `size_bytes` | As stored in R2 |
| `r2_key` | `bug-reports/<reportId>/<n>.<ext>` |
| `purged_at` | Set when the purge deleted the object |

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
| `R2_ACCOUNT_ID`, `R2_BUG_REPORTS_ACCESS_KEY_ID`, `R2_BUG_REPORTS_SECRET_ACCESS_KEY`, `R2_BUG_REPORTS_BUCKET` | All four or none. The screenshot bucket and a token with Object Read and Write on it only. Without them, reports are text only. See [Deploy on the VM](../../../../TUTORIALS/DEPLOY_ON_VM.md#bug-report-screenshots) |

The Notion database must have these properties with these exact names: `Título`, `Status` (select: Novo, Em análise, Corrigindo, Resolvido, Não é bug), `Severidade`, `Origem` (select: App, WhatsApp, E-mail, Interno), `Cliente`, `Emitente`, `Reportado por`, `Tela`, `Issue`, `Reportado em`, `ID NotaFlow`. The app fills all but `Severidade` and `Emitente`.

---

## Metrics and Alerts

| Metric | Labels |
| --- | --- |
| `notaflow_bug_reports` | `status`: `open` (active), `closed` (resolved) |
| `notaflow_bug_report_deliveries` | `channel`: `github`, `discord`, `notion`; `state`: `pending` (also `sending`), `failed` |
| `notaflow_bug_report_images` | `state`: `stored` (in R2), `purged` (deleted 30 days after the report closed) |

Both gauges read the database at scrape time. A `failed` delivery counts for 7 days, so the alert `BugDeliveriesFailed` clears by itself. The Grafana dashboard `6. Bugs` (uid `bugs`) shows the reported, active, and resolved totals, the open and closed lines, the deliveries by channel, and the stored and purged screenshots.

A failed delivery has no retry button yet. To send it again, set its `status` to `pending` and `attempts` to 0 in the database.

---

## File Locations

| File | Content |
| --- | --- |
| `apps/server/src/bugs/BugReports.ts` | The service: report, webhook status change, delivery worker |
| `apps/server/src/bugs/channels.ts` | The GitHub, Discord, and Notion clients (undici) |
| `apps/server/src/bugs/mask.ts` | `maskPersonalData` and `maskPath` |
| `apps/server/src/bugs/githubWebhook.ts` | `POST /webhooks/github` |
| `apps/server/src/bugs/images.ts` | The image checks and the R2 key |
| `apps/server/src/bugs/r2.ts` | The R2 client and the SigV4 signature |
| `apps/server/src/routes/bugReports.ts` | `POST /api/accounts/:accountId/bug-reports` and the two admin routes |
| `apps/server/src/repos/BugReportRepository.ts` | The queries on `bug_reports` and `bug_report_images` |
| `apps/web/src/components/BugReportDialog.tsx` | The dialog behind "Reportar bug" |
| `apps/web/src/components/bugImages.ts` | The resize and the WebP encoding in the browser |
| `apps/web/src/pages/AdminBugPage.tsx` | The admin page of one report |
| `deploy/monitoring/grafana/dashboards/6-bugs.json` | The Grafana dashboard |

---

## Testing

- `mask.test.ts`: each masked format, texts that must not change, and the paths.
- `bugReports.test.ts`: the three channels through an undici `MockAgent` (the masked issue, the Notion properties, the Discord links); no channel configured; a suspended account; a GitHub failure and the retry; a retry that finds the issue of a lost answer; a path with markdown stored as `/`; 5 failures to `failed`; the rate limit; the validation; the webhook signature, events, repository, idempotency, close and reopen; the gauges.
- `BugReportDialog.test.tsx`: the button only inside an account, the request body, the thanks text, and the error text.
- `images.test.ts`, `r2.test.ts`: the type, size, and first-byte checks; the SigV4 example of the AWS documentation; `PUT`, `GET`, and `DELETE` through a `MockAgent`.
- `bugImages.test.ts`: the upload before the answer, the refusal without R2, the validation, parallel reports and the limit, a failed upload and a failed commit (every key deleted), a reopen during a purge run, the channel texts, the purge (only closed over 30 days, a reopen, a 404, a failed delete, a second run), the gauge, and the admin routes.
- `channels.test.ts`: the Notion link and image count, and the issue line.
- `BugReportScreenshots.test.tsx`: pick, paste, remove, the 3-image limit, the 1 MB message, and the picker off. The resize module is mocked, because jsdom has no canvas.
- `AdminBugPage.test.tsx`: the report, the images, and the purge date.
- `rules.test.yml`: `BugDeliveriesFailed` fires on a failed delivery only.
