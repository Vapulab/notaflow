# RFC: Invoice Report PDF

**Status:** Draft, in review with the owner (2026-11-06).
**Date:** 2026-11-06
**Owner:** Lincoln Santos (Vapulab)

**References:**

- Sample report from the owner: `Relatório NFS-e.pdf` (a browser extension export, 40 pages, 535 invoices of one emitter, October 2026). Not in git: it holds real customer data. This RFC copies its columns and formulas below.
- [DANFSe PDF RFC](../10/RFC_DANFSE_PDF.md) (pdf-lib renderer, fonts, XML in `invoices.xml_gzip`, R2 client, PDF state polling)
- [Data](../../../CONVENTIONS/DATA.md), [Writing Style](../../../CONVENTIONS/WRITING_STYLE.md)
- Mockups: `.superpowers/brainstorm/6521-1793979981/content/` (local, not in git)

## Overview

A new "Relatórios" page lets a user ask for a PDF report of the NFS-e of one emitter in one period, and lists the reports that the account asked for before. The period is a month, a year, or a start and end date, always by competence date (`dCompet`). The server draws the PDF in the background, in a worker thread, and stores it in R2 for 1 year. The PDF has the NotaFlow brand, a summary on page 1, and the full list of invoices after it.

- **Who uses it:** the accountant of a company, or the company itself, at the month close.
- **Why now:** the owner and early users export this report today with a third-party browser extension, with no brand and no period on the page.

## Goals, Non-Goals, and Anti-Goals

**Goals**

1. Three period types: monthly, yearly, and custom range (start date, end date). All by competence date.
2. The same columns and totals as the sample report, plus the NotaFlow header, footer, and period.
3. A summary on page 1. Yearly reports, and custom ranges longer than one month, add a month-by-month table.
4. A history: every member of the account sees the reports of the account, who asked, when, and can download a ready report again until it expires.
5. A report of one emitter with 6,000 invoices (one large emitter, one year) is ready in under 30 seconds and does not block other requests.

**Non-goals (this RFC)**

- No automatic report at the month close, and no e-mail. The owner removed both to keep Resend costs down. The history table makes a later schedule easy.
- No CSV or spreadsheet export.
- No report of more than one emitter in one PDF.

**Anti-goals**

- A total in the PDF that differs from the sum of the XML values. The numbers come from the invoice XML only.
- A report that shows invoices of another account, or a download of a report of another account.
- Customer CPF or CNPJ in logs or in Redis.

## Decisions

| # | Decision | Made by |
| - | -------- | ------- |
| 1 | On demand only. No schedule, no e-mail. | Owner |
| 2 | Period by competence date (`dCompet`), not issue date. | Owner |
| 3 | Header option B: white header, logo for a white background, period card with a blue left border. Compact one-line header from page 2. | Owner |
| 4 | Summary option B, on page 1: total, retention, and tax cards, plus a month-by-month table when the period covers more than one month. | Owner |
| 5 | Entry point option B: a "Relatórios" page in the menu, with a form on top and the history below. | Owner |
| 6 | Footer on every page: "Gerado por NotaFlow · notaflow.vapulab.com · Relatório sem valor fiscal", emitter short name, period, "Página X de Y". | Owner |
| 7 | Cancelled invoices show in the list (red status) and stay out of all totals. The summary title says so. | Claude, accepted by the owner |
| 8 | A report is a snapshot. The PDF and the row show "Gerado em". A later cancellation does not change it; the user asks for a new one. | Claude |
| 9 | Draw in a Node worker thread inside the server, store in R2. Not in the DANFSe worker container. | Claude |
| 10 | Only invoices with `environment = 'producao'` and status `issued` or `cancelled`. | Claude |
| 12 | `tpRetISSQN` and `tpRetPisCofins` decide retained or not retained per invoice; the builder maps the codes from the NT 009 tables in `provider-nacional`. | Claude |
| 11 | Keep each PDF 1 year (365 days), then the row shows "Expirado" and the user asks again. | Owner |

**Why decision 9.** The DANFSe worker has no database access by design, so each job would carry the full invoice list, with customer documents, through Redis. A worker thread in the server reads the rows through the account-scoped repository and keeps the event loop free. Unzip, XML parse, and drawing all run in the thread. R2 holds the result, so the history survives a restart and a deploy.

## Design

### Request flow

1. The web form sends `POST /api/accounts/:accountId/reports` with `{ emitterId, period: 'month', month: '2026-10' }` (or `period: 'year', year: 2026`, or `period: 'range', from, to`).
2. The route checks the account context and the emitter of the account, validates the period (range at most 366 days, `from <= to`), counts the invoices, and answers `422 report_too_large` over the cap (20,000).
3. The route inserts an `invoice_reports` row with `status = 'pending'` and answers `202 { id }`. The same user, emitter, and period with a pending row answers the existing id (no duplicate work).
4. `ReportRunner` takes pending rows, at most 2 at a time, in creation order. For each row it reads the invoices with `InvoiceReportRepository.list(ctx, emitterId, from, to)`, posts them to a worker thread (the `ArrayBuffer` of each `xmlGzip` is transferred, not copied), and gets the PDF bytes back.
5. The thread unzips each XML, reads the report fields with `readReportFields(xml)`, sums the totals in integer cents, and draws the PDF with `@notaflow/invoice-report`.
6. The runner puts the PDF at `reports/<accountId>/<reportId>.pdf` in R2 and sets the row to `ready` with `invoiceCount`, `pages`, `bytes`, `readyAt`, and `expiresAt = readyAt + 365 days`. An error sets `failed` with an error code (never row data).
7. The page polls `GET /api/accounts/:accountId/reports` every 3 seconds while a row of the user is pending, like the DANFSe PDF state.
8. `GET /api/accounts/:accountId/reports/:id/pdf` streams the PDF from R2 with `content-disposition: attachment; filename="Relatorio-NFSe-<emitter>-<period>.pdf"`, after a check that the row belongs to the account and is `ready` and not expired.

### Restart and expiry

- On start, `ReportRunner` takes every `pending` row again. A row that is `running` for more than 5 minutes goes back to `pending` once, then to `failed`.
- A daily job sets `status = 'expired'` on rows past `expiresAt` and deletes the R2 object. The row stays (rule 9: never delete a business row). An R2 lifecycle rule on the `reports/` prefix (366 days) is the safety net.

### Components

| Component | Where | What |
| --------- | ----- | ---- |
| `@notaflow/invoice-report` | `packages/invoice-report` (new) | Pure: `ReportInput` in, PDF bytes out. pdf-lib and fontkit. Liberation Sans for text (already in `danfse-pdf`), Space Grotesk for titles, the NotaFlow logo for a white background as a vector path. |
| `readReportFields` | `packages/provider-nacional` | Reads the report fields of one NFS-e XML into integer cents. Reuses the XML parser of the provider. |
| Report routes | `apps/server/src/routes/reports.ts` (new) | Create, list, download. Validation, cap, rate limit, audit. |
| `InvoiceReportRepository`, `ReportRepository` | `apps/server/src/repos` (new) | Account-scoped reads of invoices and of report rows. |
| `ReportRunner` | `apps/server/src/reports/` (new) | Pending rows to worker threads, 2 at a time; R2 put; restart sweep; daily expiry. |
| Reports page | `apps/web/src/pages/ReportsPage.tsx` (new) | Form (emitter, period type, month, year, or dates) and history table with status and download. |

### Data model

New table `invoice_reports` (migration in `apps/server/drizzle`):

| Column | Type | Note |
| ------ | ---- | ---- |
| `id` | text | |
| `account_id`, `emitter_id` | text | Foreign keys |
| `period_type` | text | `month`, `year`, `range` |
| `period_from`, `period_to` | text | ISO dates, inclusive |
| `status` | text | `pending`, `running`, `ready`, `failed`, `expired` |
| `invoice_count`, `pages`, `bytes` | integer | Set when ready |
| `error_code` | text | Set when failed |
| `r2_key` | text | |
| `started_at`, `ready_at`, `expires_at` | timestamp | |
| `created_by`, `created_at`, `updated_at`, removal columns | | Same as other business tables |

Index on `(account_id, created_at)` for the history and on `status` for the runner.

### Storage

The `reports/` prefix of the private DANFSe R2 bucket, with the existing `R2_DANFSE_*` keys. No new env var. Without the DANFSe R2 config, the report routes answer `503 reports_unavailable`.

### Columns per invoice

The same 16 columns as the sample, in this order. A column with more than one field prints one field per line. Amounts print in Brazilian format without "R$" (`4.310,65`); a missing field prints "-" and counts as 0. Retained amounts print in red, as in the sample.

| # | Head | Fields, one per line |
| - | ---- | -------------------- |
| 1 | Tipo | Status: "Emitida" or "Cancelada" (red) |
| 2 | Nota | `nNFSe` |
| 3 | Datas | `dCompet`, `dhEmi` (dd/mm/yyyy) |
| 4 | Tomador | `xNome` (cut with an ellipsis), CNPJ or CPF with mask |
| 5 | Local / Serviço | `xLocIncid`, `cTribNac`, `cNBS` |
| 6 | TpRet ISSQN | `tpRetISSQN` as the code (for example `2`) |
| 7 | Alíq. | `pAliq` (`5,00%`) |
| 8 | ISSQN | `vISSQN` |
| 9 | TpRet PIS/COFINS | `tpRetPisCofins` as the code |
| 10 | PIS/COFINS | `CST`, `vPis`, `vCofins` |
| 11 | IBS/CBS | `vIBSUF`, `vIBSMun`, `vCBS` |
| 12 | CP | `vRetCP` |
| 13 | IRRF | `vRetIRRF` |
| 14 | CSLL | `vRetCSLL` |
| 15 | Desc/Ded/Red | `vDescIncond`, `vDescCond`, `vDR` |
| 16 | Serviço | `vServ`, `vLiq` (red) |

The last row of each page is a running total of `vServ`, as in the sample.

### Summary formulas

The summary uses the same formulas as the sample. Each card shows its formula in field names under the title, so the accountant can check it. Sums cover issued invoices only.

| Card | Formula | Sample value (Oct 2026) |
| ---- | ------- | ----------------------- |
| Valor serviço | sum `vServ` | 3.416.582,36 |
| Valor total retenções | sum `vTotalRet` | 704.073,18 |
| Descontos | sum (`vDescIncond` + `vDescCond`) | 0,01 |
| Valor líquido | sum `vLiq` | 2.712.509,17 |
| Retenção CP | sum `vRetCP` | 372.344,01 |
| Retenção IRRF | sum `vRetIRRF` | 45.863,89 |
| Retenção PIS/COFINS/CSLL | sum `vRetCSLL` | 157.212,75 |
| Retenção ISSQN | sum `vISSQN` where `tpRetISSQN` is a retained code | 128.652,53 |
| ISSQN não retido | sum `vISSQN` where `tpRetISSQN` = 1 (not retained) | 0,00 |
| PIS/COFINS operação própria | sum (`vPis` + `vCofins`) where `tpRetPisCofins` says not retained | 0,00 |
| IBS/CBS | `vIBSUF`, `vIBSMun`, `vCBS`, and their sum. The sample also lists `vIBSSN` and `vCBSSN`; the NT 009 schema has no such fields, so the report leaves them out. | 32.879,46 |

In the sample, CP + IRRF + PIS/COFINS/CSLL + ISSQN retained equals `vTotalRet`. A test checks this on synthetic data. In production, the card shows the sum of `vTotalRet` from the XML, never the sum of the four cards.

### Invoices with no XML

An `issued` or `cancelled` row with a null `xml_gzip` shows in the list with "-" in each XML field and stays out of the totals. Page 1 shows "N notas sem XML ficaram fora dos totais". The report does not fail.

### Page layout

A4 landscape. Page 1: full header (logo, title, emitter name and CNPJ, count chips, generated time, period card), then the summary. Page 2 onward: one-line header and the invoice table, with the column heads on every page. The footer is on every page. No invoices in the period: page 1 shows the period and the text "Nenhuma nota no período", and the report is still `ready`.

## Web

- A "Relatórios" item in the app menu, after "Notas".
- Form card: emitter (the first emitter of the account is the default), segmented control Mensal / Anual / Por período, then a month picker (default: last month), a year picker, or two date fields. "Gerar PDF" adds a row at the top of the history at once.
- History table: emitter, period ("Outubro de 2026", "2026", "01/07 a 30/09/2026"), who asked and when, status tag (Na fila, Gerando…, Pronto, Falhou, Expirado), and "Baixar" when ready. "Falhou" offers "Tentar de novo". Newest first, 20 per page.

## Metrics, Limits, and Security

- Metrics: `report_render_seconds` (histogram), `report_invoices` (histogram), `report_pending` (gauge), `report_failures_total` (by reason). A Grafana alert when a report stays pending for more than 10 minutes.
- Rate limit: 10 new reports per hour per account.
- No row data in logs. The audit log records create and download, with the report id, emitter id, and period.

## Testing

- `readReportFields`: unit tests on synthetic XML from `@notaflow/test-kit`, one per field group, plus a missing-field case.
- `@notaflow/invoice-report`: a golden test that extracts the PDF text with `unpdf` and checks the header, period, totals, and page count for 0, 1, 30, and 600 rows.
- Routes: account isolation on create, list, and download; period validation; the cap; duplicate pending request; expired download answers 410.
- Runner: pending to ready, failure, restart sweep, expiry with a fake R2.
- A timing test for 6,000 synthetic rows (local only, not in CI).

## C4

- Level 2 (containers): no new container. The API server description adds "invoice reports". The R2 description adds the report PDFs (1 year), and the edge server to R2 adds "report PDFs".
- Level 3 (server components): add **Invoice reports** (`routes/reports`, `reports/ReportRunner`, `packages/invoice-report`, worker threads). Edges: routes to reports, reports to repositories, reports to R2.
- Update the `.mmd` sources and the PNGs in the same PR.

## Roadmap

1. `readReportFields` in `provider-nacional`, with tests.
2. `@notaflow/invoice-report`: layout, summary, table, golden tests.
3. Server: table and migration, repositories, runner, routes, R2, metrics, audit, C4.
4. Web: menu item and Reports page.
5. Manual check against the owner's sample month: every total in the summary equals the sample.

## Left to the Builder

- The exact column widths and row height. Long customer names cut with an ellipsis.
- The font for titles, if Space Grotesk is too heavy for the PDF size (fallback: Liberation Sans Bold).
- The worker thread code: a small pool on `node:worker_threads`, or a library. No new runtime dependency without a reason in the PR.
