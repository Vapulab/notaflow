# Invoice Report PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Relatórios" page where a user asks for a branded PDF report of the NFS-e of one emitter in a month, a year, or a date range (by competence), and downloads it from a history for 1 year.

**Architecture:** `provider-nacional` reads the report fields from each invoice XML. A new pure package, `@notaflow/invoice-report`, sums the rows and draws the PDF with pdf-lib. In the server, a `ReportRunner` takes pending `invoice_reports` rows, renders each one in a `node:worker_threads` thread, puts the PDF in R2 (`reports/` prefix of the DANFSe bucket), and expires it after 365 days. The web app gets a Reports page with a form and a polled history.

**Tech Stack:** TypeScript, Node 22 (tsx at runtime), Fastify, drizzle + better-sqlite3, pdf-lib + @pdf-lib/fontkit, @xmldom/xmldom, `@notaflow/r2`, React + Vite, Vitest, unpdf.

**Spec:** [RFC: Invoice Report PDF](../../RFCS/2026/11/RFC_INVOICE_REPORT.md). Read sections Decisions, Design, Columns per invoice, Summary formulas, and Web before any task.

## Global Constraints

- Branch from `origin/production` (the local `production` is behind). Branch name: `feat/invoice-report`. The PR goes to `production`.
- Amounts are integer cents in code. Format only at draw time: `4.310,65` in the table, `R$ 3.416.582,36` in the summary.
- Period is by competence (`invoices.competence`, stored as `YYYY-MM-DD`). Never filter by `issued_at`.
- Only rows with `environment = 'producao'`, status `issued` or `cancelled`, and `notDeleted`. Cancelled rows are listed, never summed.
- The numbers come from the XML only. A row with no XML, or with an XML that does not parse, lists "-" and stays out of the totals; page 1 says "N notas sem XML ficaram fora dos totais".
- Cap: 20,000 invoices per report (`422 report_too_large`). Range at most 366 days. Rate limit: 10 new reports per hour per account.
- Retention: `expiresAt = readyAt + 365 days`. R2 key: `reports/<accountId>/<reportId>.pdf`.
- At most 2 renders at a time. A render that runs longer than 120 s is killed and the row fails with `timeout`.
- Never log row data, customer documents, or names. Audit `detail` holds the report id, emitter id, and period only.
- Footer text, exact: `Gerado por NotaFlow · notaflow.vapulab.com · Relatório sem valor fiscal`. Use the logo for a white background (N `#090d14`, F and arrow `#121774`).
- Project rules: no `!` non-null assertions; one-line comments, only the non-obvious why; the migration goes in the same commit as the schema; never delete a business row (soft delete, `notDeleted`, no-delete trigger); scripts run on Windows and Linux; no AI attribution in commits or PRs; never `--no-verify`; English text in Simplified Technical English with no em dash; the C4 `.mmd` and PNG change in the same PR.

## Review Focus

1. **Month edges.** An invoice with competence `2026-10-31` is in October; `2026-11-01` is not; an invoice issued on 2026-11-02 with competence October is in October. Test in Task 4 (`lists invoices by competence at month edges`).
2. **Another account.** Create with an emitter of another account answers 404; list never shows another account's rows; download of another account's report answers 404. Test in Task 6 (`isolates accounts`).
3. **Sparse XML.** An XML with no `IBSCBS`, no `tribFed`, and no `vDescCondIncond` reads as "missing" fields (null cents), prints "-", and sums as 0. Test in Task 1 (`reads a sparse invoice`).
4. **Restart mid-render.** A row left `running` by a dead process goes back to `pending` on start and ends `ready`. Test in Task 5 (`recovers running rows on start`).
5. **Range across years.** `2025-12-15` to `2026-01-20` gives two month lines, "Dez/2025" and "Jan/2026", each with the year. Test in Task 2 (`labels months across a year change`).

---

### Task 1: Read the report fields from the invoice XML

**Files:**
- Create: `packages/provider-nacional/src/parse/readReportFields.ts`
- Create: `packages/provider-nacional/src/parse/readReportFields.test.ts`
- Modify: `packages/provider-nacional/src/index.ts` (export the new names)

**Interfaces:**
- Consumes: `parseXmlRoot`, `child`, `text` from `src/xml/readXml.ts`; `decimalToCents` from `src/xml/formatters.ts`. Read the XPaths from `packages/danfse-pdf/src/readDanfseData.ts` (it already reads every field below).
- Produces:

```ts
export type ReportCents = {
  service: number | null; net: number | null; iss: number | null;
  pis: number | null; cofins: number | null;
  ibsUf: number | null; ibsMun: number | null; cbs: number | null;
  retCp: number | null; retIrrf: number | null; retCsll: number | null; totalRet: number | null;
  discountUncond: number | null; discountCond: number | null; deduction: number | null;
};
export type ReportFields = {
  number?: string; competence?: string; issuedAt?: string; // dCompet as YYYY-MM-DD, dhEmi as in the XML
  municipality?: string; nationalCode?: string; nbsCode?: string; // xLocIncid, cTribNac, cNBS
  issWithholding?: string; issRate?: string; // tpRetISSQN, pAliq as written in the XML ("5.00")
  pisCofinsWithholding?: string; cst?: string; // tpRetPisCofins, CST of piscofins
  cents: ReportCents; // null = the field is not in the XML
};
export function readReportFields(xml: string): ReportFields;
export function issRetained(code: string | undefined): boolean; // '2' or '3'
export function pisCofinsRetained(code: string | undefined): { pis: boolean; cofins: boolean };
```

`pisCofinsRetained` table (codes from NT 009, `PIS_COFINS_WITHHOLDING` in `danfse-pdf/src/codes.ts`); undefined or unknown code = both false:

| Code | pis | cofins |
| ---- | --- | ------ |
| 0, 2, 8 | false | false |
| 1, 3, 4 | true | true |
| 5, 9 | true | false |
| 6, 7 | false | true |

- [ ] **Step 1: Write the failing tests** in `readReportFields.test.ts`, using `readFixture` from `../../test/fixtures`:
  - `reads the domestic invoice`: on `NFSE_DOMESTIC`, `number`, `competence`, `municipality`, `nationalCode`, and `cents.service`, `cents.net`, `cents.iss` equal the values in the fixture XML (read them from the file; assert exact integers).
  - `reads the IBS/CBS and retention groups`: on `NFSE_EXPORT_FULL` (or the fixture that has `IBSCBS` and `vRetCP`), assert `ibsUf`, `ibsMun`, `cbs`, `retCp`, `retIrrf`, `retCsll`, `totalRet` from the fixture.
  - `reads a sparse invoice`: remove the `IBSCBS`, `tribFed`, and `vDescCondIncond` elements from `NFSE_DOMESTIC` with string replace; assert `cents.ibsUf`, `cents.pis`, `cents.discountCond` are `null`, and no throw.
  - `maps the retention codes`: every row of the table above, plus `issRetained('1') === false`, `issRetained('2') === true`, `issRetained(undefined) === false`.
  - `throws on a non-NFS-e root`: `readReportFields('<x/>')` throws `NfseParseError`.
- [ ] **Step 2: Run** `pnpm vitest run packages/provider-nacional/src/parse/readReportFields.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `readReportFields`, `issRetained`, `pisCofinsRetained`. A money field that is present but does not parse makes the whole call throw (the runner then treats the row as "no XML").
- [ ] **Step 4: Run** the test again. Expected: PASS. Then `pnpm --filter @notaflow/provider-nacional typecheck`.
- [ ] **Step 5: Commit** `feat(provider): read the invoice report fields from the NFS-e XML`.

---

### Task 2: Period and summary in `@notaflow/invoice-report`

**Files:**
- Create: `packages/invoice-report/package.json` (name `@notaflow/invoice-report`, `"type": "module"`, exports `".": "./src/index.ts"` and `"./period": "./src/period.ts"`, script `typecheck`; deps `@notaflow/provider-nacional`, `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1; devDeps `unpdf` 1.8.1). Copy `tsconfig.json` from `packages/danfse-pdf`.
- Create: `packages/invoice-report/AGENTS.md` (same shape as `packages/danfse-pdf/AGENTS.md`; rule 1: numbers come from `ReportFields` only; rule 2: `./period` has no pdf-lib import, the web app uses it).
- Create: `packages/invoice-report/src/period.ts`, `src/period.test.ts`
- Create: `packages/invoice-report/src/types.ts`, `src/summarize.ts`, `src/summarize.test.ts`
- Create: `packages/invoice-report/src/index.ts`
- Modify: root `AGENTS.md` (row in Package entrypoints)

**Interfaces:**
- Consumes: `ReportFields`, `issRetained`, `pisCofinsRetained` (Task 1).
- Produces:

```ts
// period.ts
export type PeriodType = 'month' | 'year' | 'range';
export type ReportPeriod = { type: PeriodType; from: string; to: string }; // ISO dates, inclusive
export class PeriodError extends Error { constructor(readonly code: 'period_invalid' | 'period_too_long') }
export function monthPeriod(month: string): ReportPeriod;   // 'YYYY-MM'
export function yearPeriod(year: number): ReportPeriod;
export function rangePeriod(from: string, to: string): ReportPeriod; // from <= to, at most 366 days
export function periodLabel(p: ReportPeriod): string; // 'Outubro de 2026' | '2026' | '01/07/2026 a 30/09/2026'
export function periodSlug(p: ReportPeriod): string;  // '2026-10' | '2026' | '2026-07-01_2026-09-30'
export function spansMonths(p: ReportPeriod): boolean; // true when from and to are in different months

// types.ts
export type ReportRow = {
  status: 'issued' | 'cancelled';
  number: string | null; customerName: string | null; customerDocument: string | null;
  fields: ReportFields | null; // null = no XML, or the XML did not parse
};
export type ReportInput = {
  emitter: { legalName: string; cnpj: string; shortName: string };
  period: ReportPeriod; generatedAt: Date; rows: ReportRow[];
};
export type ReportTotals = {
  service: number; totalRet: number; discounts: number; net: number;
  retCp: number; retIrrf: number; retCsll: number; issRetained: number;
  issNotRetained: number; ownPisCofins: number; ibsUf: number; ibsMun: number; cbs: number; ibsCbs: number;
};
export type MonthLine = { month: string; label: string; count: number; service: number; totalRet: number; net: number }; // month 'YYYY-MM', label 'Out/2026'
export type ReportSummary = {
  issuedCount: number; cancelledCount: number; missingXmlCount: number;
  totals: ReportTotals; months: MonthLine[]; // months is [] unless spansMonths(period)
};

// summarize.ts
export function summarize(rows: ReportRow[], period: ReportPeriod): ReportSummary;
```

Formulas: copy the "Summary formulas" table of the RFC. `discounts = discountUncond + discountCond`; `issRetained` sums `iss` where `issRetained(code)`; `issNotRetained` sums `iss` where not; `ownPisCofins` sums `pis` where `!pisCofinsRetained(code).pis` plus `cofins` where `!…cofins`; `ibsCbs = ibsUf + ibsMun + cbs`. Null counts as 0. Cancelled rows and rows with `fields: null` are not summed. `missingXmlCount` counts issued rows with `fields: null`. Month lines cover every month from `from` to `to`, zero lines included, keyed by `fields.competence`.

- [ ] **Step 1: Write the failing tests.**
  - `period.test.ts`: `monthPeriod('2026-02')` is `{ type: 'month', from: '2026-02-01', to: '2026-02-28' }`; `monthPeriod('2028-02').to === '2028-02-29'`; `yearPeriod(2026)` is `2026-01-01` to `2026-12-31`; `rangePeriod('2026-09-30', '2026-07-01')` throws `period_invalid`; `rangePeriod('2025-01-01', '2026-01-03')` throws `period_too_long`; `rangePeriod('2024-01-01', '2024-12-31')` passes (366 days); `periodLabel` and `periodSlug` for one period of each type, exact strings above; `spansMonths` false for a month, true for a year.
  - `summarize.test.ts`, with a local `row(overrides)` helper that builds a `ReportRow`:
    - `sums issued rows only`: two issued rows (service 431065 and 422728) and one cancelled row (service 3432563); `totals.service === 853793`, `issuedCount 2`, `cancelledCount 1`.
    - `matches the sample formulas`: one issued row with retCp 37234401, retIrrf 4586389, retCsll 15721275, iss 12865253 (code '2'), totalRet 70407318; assert each card total and that `retCp + retIrrf + retCsll + issRetained === totalRet`.
    - `splits own PIS/COFINS by code`: code '5', pis 410, cofins 900 gives `ownPisCofins === 900`.
    - `keeps rows with no XML out`: an issued row with `fields: null`; `missingXmlCount 1`, totals 0.
    - `labels months across a year change`: range `2025-12-15`..`2026-01-20`; `months.map(m => m.label)` equals `['Dez/2025', 'Jan/2026']`.
    - `has no month lines for one month`: `monthPeriod('2026-10')` gives `months` `[]`.
- [ ] **Step 2: Run** `pnpm vitest run packages/invoice-report`. Expected: FAIL.
- [ ] **Step 3: Implement** `period.ts`, `types.ts`, `summarize.ts`, and `index.ts` (export all of them; `renderReport` comes in Task 3). Use UTC date math on ISO strings; no time zones are involved.
- [ ] **Step 4: Run** `pnpm install`, the tests, and `pnpm --filter @notaflow/invoice-report typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(invoice-report): add the report period and summary`.

---

### Task 3: Draw the report PDF

**Files:**
- Create: `packages/invoice-report/assets/` with `LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf`, `LICENSE-liberation-fonts.txt` (copies from `packages/danfse-pdf/assets/`), `SpaceGrotesk-Bold.ttf`, `OFL.txt`, and `SOURCE.md` (where each file came from, and its license).
- Create: `packages/invoice-report/src/draw.ts` (fonts, `formatCents`, `formatMoney`, `drawLogo`, text fit with an ellipsis)
- Create: `packages/invoice-report/src/renderReport.ts`, `src/renderReport.test.ts`
- Create: `packages/invoice-report/src/pdfText.test-util.ts` (copy of `packages/danfse-pdf/src/pdfText.test-util.ts`)
- Create: `packages/invoice-report/scripts/sample.ts` (writes `sample-<n>.pdf` for 0, 30, and 600 synthetic rows to `packages/invoice-report/sample/`, git-ignored, for a look by eye)
- Modify: `packages/invoice-report/src/index.ts`, `.gitignore`

**Interfaces:**
- Consumes: `ReportInput`, `summarize`, `periodLabel`, `spansMonths` (Task 2); `formatBrasiliaDateTime` from `@notaflow/provider-nacional`.
- Produces: `export function renderReport(input: ReportInput): Promise<{ pdf: Uint8Array; pages: number }>`.

Layout (A4 landscape, 842 x 595 pt). Copy the look of the approved mockup: `.superpowers/brainstorm/6521-1793979981/content/prototype.html` (open it in a browser; it is not in git, so the reviewer of this task gets the screenshots from the PR).
- Page 1: full header (logo 30 pt high, title `Relatório de NFS-e emitidas` in Space Grotesk Bold `#121774`, legal name and masked CNPJ, chips `N notas`, `N emitidas`, `N canceladas`, `Gerado em dd/mm/aaaa às hh:mm` in Brasília time), a period card on the right (`Período · Mensal|Anual|Por período`, `periodLabel`, `Competência de dd/mm/aaaa a dd/mm/aaaa`, left border `#1e40af`). Then the summary: Totais (4 cards, Valor líquido highlighted), Retenções (4 cards), Impostos (ISSQN não retido, PIS/COFINS operação própria, IBS/CBS with the three parts on one line). Each card shows its formula in field names under the title. Then the month table when `months.length > 0`. Then the "sem XML" line when `missingXmlCount > 0`. With no rows: the text `Nenhuma nota no período` in place of the summary cards.
- Page 2 onward: one-line header (logo 18 pt, `Relatório de NFS-e`, legal name and CNPJ, `Mensal · Outubro de 2026` on the right), the 16 columns of the RFC table "Columns per invoice" with their heads on every page, zebra rows, retained amounts and `Cancelada` in `#dc2626`, and at the bottom of each page `Acumulado do valor serviço até esta página: <sum of vServ of issued rows so far>`.
- Footer on every page: logo 12 pt, the exact footer text, and `<shortName> · <periodLabel> · Página X de Y` on the right. Draw footers after all pages exist, so Y is known.
- Logo: the paths of `apps/web/public/logo.svg` with `page.drawSvgPath`. To copy the SVG mask, draw the N in `#090d14`, then the arrow path with a white stroke 6 units wide, then the F and the arrow in `#121774`.

- [ ] **Step 1: Write the failing tests** in `renderReport.test.ts`, with `pdfFacts` and a synthetic-row builder:
  - `draws page 1 with the period and totals`: 30 rows for `monthPeriod('2026-10')`; text contains `Relatório de NFS-e emitidas`, `Outubro de 2026`, `Competência de 01/10/2026 a 31/10/2026`, the formatted `R$` service total from `summarize`, and `Gerado por NotaFlow · notaflow.vapulab.com · Relatório sem valor fiscal`; `width` 842 and `height` 595 (rounded).
  - `numbers every page`: 600 rows; `pages` returned equals `pdfFacts().pages`, is greater than 2, and the text contains `Página 1 de <pages>` and `Página <pages> de <pages>`.
  - `prints an empty period`: 0 rows; text contains `Nenhuma nota no período`; `pages === 1`.
  - `adds the month table for a year`: `yearPeriod(2026)` with rows in March and October; text contains `Mar/2026` and `Out/2026`.
  - `marks cancelled rows`: one cancelled row; text contains `Cancelada`, and the service total excludes it.
  - `notes rows with no XML`: one issued row with `fields: null`; text contains `1 notas sem XML ficaram fora dos totais` (adjust the wording for 1 to `1 nota sem XML ficou fora dos totais`, and test both forms).
- [ ] **Step 2: Run** `pnpm vitest run packages/invoice-report/src/renderReport.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `draw.ts` and `renderReport.ts`. Embed fonts with `{ subset: true }`; load assets the same way as `danfse-pdf/src/renderDanfse.ts` (`new URL('../assets/…', import.meta.url)`).
- [ ] **Step 4: Run** the tests, then `pnpm --filter @notaflow/invoice-report exec tsx scripts/sample.ts` and open `sample-600.pdf`. Compare it with the mockup. Time the 6,000-row case once by hand (target: under 15 s for render alone) and write the number in the PR.
- [ ] **Step 5: Commit** `feat(invoice-report): draw the branded report PDF`.

---

### Task 4: Report table and repositories

**Files:**
- Modify: `apps/server/src/db/schema.ts` (table `invoiceReports`)
- Create: `apps/server/drizzle/0029_invoice_reports.sql` (generated with `pnpm --filter @notaflow/server exec drizzle-kit generate --name invoice_reports`, then add by hand `CREATE TRIGGER invoice_reports_no_delete BEFORE DELETE ON invoice_reports BEGIN SELECT RAISE(ABORT, 'soft delete only'); END;`)
- Modify: `apps/server/src/db/businessTables.ts` (add `invoice_reports` to `BUSINESS_TABLES`)
- Create: `apps/server/src/repos/ReportRepository.ts`, `ReportRepository.test.ts`
- Create: `apps/server/src/repos/ReportJobRepository.ts`, `ReportJobRepository.test.ts`

**Interfaces:**
- Consumes: `ReportPeriod` (Task 2); `AccountContext`; `created`, `touched`, `notDeleted` from `src/db/stamps.ts`.
- Produces: the table, with the columns of the RFC "Data model" plus `attempts integer not null default 0`; `createdAt: createdAt()`, `updatedAt: changedAt()`, `...authors()`, `...removal()`; status enum `pending | running | ready | failed | expired`; indexes `(account_id, created_at)` and `(status)`.

```ts
export type ReportRecord = typeof invoiceReports.$inferSelect;
export type ReportView = {
  id: string; emitterId: string; emitterName: string;
  period: ReportPeriod; status: ReportRecord['status'];
  invoiceCount: number | null; errorCode: string | null;
  createdByName: string | null; createdAt: string; readyAt: string | null; expiresAt: string | null;
};

// Account scope: every method checks ctx.accountId.
export class ReportRepository {
  constructor(db: Database);
  countInvoices(ctx: AccountContext, emitterId: string, period: ReportPeriod): number | null; // null = emitter not in the account
  create(ctx: AccountContext, emitterId: string, period: ReportPeriod): ReportRecord; // returns the open (pending or running) row of the same user, emitter, and period when one exists
  list(ctx: AccountContext, offset: number, limit: number): { reports: ReportView[]; total: number };
  get(ctx: AccountContext, id: string): ReportRecord | null;
  retry(ctx: AccountContext, id: string): ReportRecord | null; // failed -> pending, attempts 0; other states unchanged
}

// Platform scope, for the runner only (same pattern as DanfseRepository).
export type ReportJob = { report: ReportRecord; emitter: { legalName: string; cnpj: string; shortName: string } };
export type ReportInvoiceRow = { status: 'issued' | 'cancelled'; number: string | null; customerName: string | null; customerDocument: string | null; xmlGzip: Buffer | null };
export class ReportJobRepository {
  constructor(db: Database);
  claimNext(now: Date): ReportJob | null;           // oldest pending -> running, startedAt = now, attempts + 1
  invoices(job: ReportJob): ReportInvoiceRow[];     // emitter of job.report, joined to emitters.account_id = report.account_id
  markReady(id: string, r: { r2Key: string; invoiceCount: number; pages: number; bytes: number; readyAt: Date; expiresAt: Date }): void;
  markFailed(id: string, errorCode: string): void;
  recoverRunning(): number;                         // every running -> pending (on start)
  failStale(now: Date, maxRunMs: number): number;   // running longer than maxRunMs: attempts < 2 -> pending, else failed 'timeout'
  dueForExpiry(now: Date): { id: string; r2Key: string }[];
  markExpired(id: string): void;
  oldestPendingAgeMs(now: Date): number | null;
}
```

`shortName`: the emitter trade name when present, else the first two words of the legal name. Invoice rows are ordered by `CAST(number AS INTEGER)`, nulls last. `countInvoices` and `invoices` apply the Global Constraints filter (production, issued or cancelled, competence between `from` and `to`, `notDeleted`).

- [ ] **Step 1: Write the failing tests** with `seedTenant` and the invoice setup helpers in `apps/server/test/`:
  - `lists invoices by competence at month edges`: invoices with competence `2026-09-30`, `2026-10-01`, `2026-10-31`, `2026-11-01`, plus one with competence `2026-10-15` and `issued_at` 2026-11-02; `invoices()` for October returns the three October rows.
  - `filters environment, status, and deleted rows`: a `producao_restrita` row, a `rejected` row, a `pending` row, and a soft-deleted row are left out; a `cancelled` row is in.
  - `countInvoices returns null for an emitter of another account`.
  - `create reuses an open request`: two `create` calls with the same user, emitter, and period return the same id; a different period gives a new id.
  - `list shows only the account's reports, newest first, with the creator's name`.
  - `claimNext takes the oldest pending row` and sets `running` and `attempts 1`; a second call with one row returns `null`.
  - `recoverRunning and failStale`: per the comments above.
  - `dueForExpiry` returns only `ready` rows with `expiresAt <= now`.
  - `the table refuses a delete`: a raw `DELETE` throws `soft delete only` (and `migrations.test.ts` passes).
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/repos/Report`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, migration, `BUSINESS_TABLES` entry, and both repositories.
- [ ] **Step 4: Run** the tests and `pnpm vitest run apps/server/src/db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): add the invoice_reports table and repositories`.

---

### Task 5: Render thread and ReportRunner

**Files:**
- Create: `apps/server/src/reports/renderThread.ts` (the thread entry)
- Create: `apps/server/src/reports/renderInThread.ts`, `renderInThread.test.ts`
- Create: `apps/server/src/reports/ReportRunner.ts`, `ReportRunner.test.ts`
- Modify: `apps/server/src/metrics/metrics.ts` (and `MetricSources`)

**Interfaces:**
- Consumes: `ReportJobRepository`, `ReportJob`, `ReportInvoiceRow` (Task 4); `readReportFields` (Task 1); `renderReport`, `ReportInput`, `ReportRow` (Tasks 2 and 3); `R2Client` from `@notaflow/r2`.
- Produces:

```ts
// renderInThread.ts
export type ThreadInput = { emitter: ReportInput['emitter']; period: ReportPeriod; generatedAt: string; rows: ReportInvoiceRow[] };
export type ThreadResult = { pdf: Buffer; pages: number; invoiceCount: number };
export class RenderTimeoutError extends Error {}
export function renderInThread(input: ThreadInput, opts?: { timeoutMs?: number }): Promise<ThreadResult>; // default 120_000

// ReportRunner.ts
export type ReportRunnerDeps = {
  jobs: ReportJobRepository;
  r2: Pick<R2Client, 'put' | 'delete'>;
  render?: typeof renderInThread;
  metrics?: Pick<Metrics, 'reportRendered' | 'reportJob'>;
  now?: () => Date;
};
export class ReportRunner {
  constructor(deps: ReportRunnerDeps);
  recoverOnStart(): number;
  tick(): Promise<void>;          // failStale(now, 300_000), then claim up to 2 jobs and await them
  expire(): Promise<number>;      // delete each due R2 object, then markExpired
}

// Metrics: public methods
reportRendered(seconds: number, invoices: number): void; // report_render_seconds, report_invoices histograms
reportJob(result: 'ready' | 'failed'): void;             // report_jobs_total{result}
// MetricSources gains reportOldestPendingSeconds(): number -> gauge report_oldest_pending_seconds
```

`renderInThread` starts `new Worker(new URL('./renderThread.ts', import.meta.url), { execArgv: ['--import', 'tsx'], workerData })`, the same runtime trick as `onboarding/cardReader.ts`. Pass each `xmlGzip` as its own `ArrayBuffer` in the transfer list. The thread does `gunzipSync`, `readReportFields` in a try (a throw gives `fields: null`), builds `ReportRow`s, calls `renderReport`, and posts `{ pdf, pages, invoiceCount }`. On timeout, `worker.terminate()` and reject with `RenderTimeoutError`.

The runner's `put` key is `reports/<accountId>/<reportId>.pdf`, content type `application/pdf`. Error codes: `timeout`, `render_failed`, `storage_failed`. Never put the error message in the row or the log with row data; log the report id and the code.

- [ ] **Step 1: Write the failing tests.**
  - `renderInThread.test.ts`: `renders in a thread` (3 rows with the `NFSE_DOMESTIC` fixture XML gzipped; result `pages >= 2`, `invoiceCount 3`, the PDF starts with `%PDF`); `treats a bad XML as missing` (one row with gzipped `<x/>`; the result still renders, and the PDF text has `1 nota sem XML ficou fora dos totais`); `times out` (`timeoutMs: 1` rejects with `RenderTimeoutError`).
  - `ReportRunner.test.ts`, with a real test DB, a fake R2 (records `put` and `delete` calls), a fake `render`, and a fixed `now`:
    - `renders a pending report`: the row ends `ready` with `r2Key`, `pages`, `bytes`, `expiresAt = readyAt + 365 days`; R2 got one `put` with that key.
    - `runs at most two at a time`: 3 pending rows and a `render` that waits on a promise; after one `tick` starts, 2 rows are `running` and 1 is `pending`.
    - `fails on a render error` (`render_failed`) and `fails on a storage error` (`storage_failed`); `reportJob('failed')` is called.
    - `recovers running rows on start`: a `running` row; `recoverOnStart()` returns 1; the next `tick` makes it `ready`.
    - `expires due reports`: a `ready` row with `expiresAt` in the past; `expire()` deletes its key in R2 and the row is `expired`.
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/reports`. Expected: FAIL.
- [ ] **Step 3: Implement** the thread, `renderInThread`, `ReportRunner`, and the metrics.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): render invoice reports in a worker thread`.

---

### Task 6: Report routes and wiring

**Files:**
- Create: `apps/server/src/routes/reports.ts`, `reports.test.ts`
- Modify: `apps/server/src/app.ts` (register the routes; `AppDeps.reportsR2?: Pick<R2Client, 'put' | 'get' | 'delete'>`, defaulting to `r2Client(config.danfse.r2)` when `config.danfse` is set)
- Modify: `apps/server/src/main.ts` (when R2 is set: `runner.recoverOnStart()`, `startScheduler(() => runner.tick(), 5_000, …)`, `startScheduler(() => runner.expire(), 3_600_000, …)`)
- Modify: `apps/server/test/testApp.ts` (option `reportsR2`, and a way to run `runner.tick()` in tests)
- Modify: `apps/server/AGENTS.md` (one line on reports)

**Interfaces:**
- Consumes: `ReportRepository`, `ReportView` (Task 4); `ReportRunner` (Task 5); `monthPeriod`, `yearPeriod`, `rangePeriod`, `PeriodError`, `periodSlug` (Task 2); `accountContext`, `HttpError`, `createRateLimiter`, `AuditLog`.
- Produces (the web app relies on these exact shapes):

| Method and path | Body or query | Answer |
| --------------- | ------------- | ------ |
| `POST /api/accounts/:accountId/reports` | `{ emitterId, period: 'month', month: 'YYYY-MM' }` or `{ …, period: 'year', year: number }` or `{ …, period: 'range', from, to }` | `202 { report: ReportView }` |
| `GET /api/accounts/:accountId/reports` | `?offset=0` (page size 20) | `200 { reports: ReportView[], total: number }` |
| `GET /api/accounts/:accountId/reports/:reportId/pdf` | | `200 application/pdf`, `content-disposition: attachment; filename="Relatorio-NFSe-<cnpj>-<periodSlug>.pdf"` |
| `POST /api/accounts/:accountId/reports/:reportId/retry` | | `202 { report: ReportView }` |

Errors: `400 period_invalid | period_too_long` (from `PeriodError`) and `400 invalid_body`; `404 not_found` (emitter or report not in the account); `409 report_not_ready` (download of a row that is not `ready`); `409 report_not_failed` (retry of a row that is not `failed`); `410 report_expired`; `422 report_too_large` (over 20,000); `429 too_many_requests` (11th create in one hour for the account); `503 reports_unavailable` (R2 not set). The POST routes use `accountContext(request, accountId, { write: true })`. Audit: `report.create` and `report.download`, entity = report id, detail `{ emitterId, period }`.

- [ ] **Step 1: Write the failing tests** in `reports.test.ts` with `createTestApp({ reportsR2: fakeR2 })`:
  - `creates, renders, lists, and downloads`: POST a month, run the runner tick, GET the list (status `ready`, `invoiceCount`), GET the PDF (status 200, `content-type` `application/pdf`, the filename above, body starts with `%PDF`).
  - `isolates accounts`: an emitter of account B in a POST of account A gives 404; A's list has no B rows; A downloading B's report id gives 404.
  - `validates the period`: `month: '2026-13'` gives 400 `period_invalid`; a 400-day range gives 400 `period_too_long`.
  - `refuses a report over the cap`: with the cap lowered through a `maxInvoices` option in the routes' deps (default 20,000; do not seed 20,001 rows), 422 `report_too_large`.
  - `rate limits creates`: the 11th POST in the same hour gives 429.
  - `does not duplicate an open request`: two POSTs with the same body return the same id.
  - `answers 409 before ready and 410 after expiry`.
  - `retries a failed report`: a `failed` row; retry gives 202 and status `pending`; retry of a `ready` row gives 409 `report_not_failed`.
  - `answers 503 when R2 is not set`.
  - `records the audit rows` for create and download, with no customer data in `detail`.
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/routes/reports.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the wiring.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(server): add the invoice report routes`.

---

### Task 7: Reports page in the web app

**Files:**
- Modify: `apps/web/src/router.ts` (route `{ name: 'reports'; accountId: string }`, path segment `relatorios`, `parseRoute` and `routeHref` cases), `apps/web/src/router.test.ts`
- Modify: `apps/web/src/App.tsx` (`Screen` case)
- Modify: `apps/web/src/components/Layout.tsx` (`SECTIONS`: `{ name: 'reports', label: 'Relatórios', current: ['reports'] }` right after Notas)
- Create: `apps/web/src/pages/ReportsPage.tsx`, `ReportsPage.test.tsx`
- Modify: `apps/web/src/api.ts` (types `ReportView`, `ReportStatus`)

**Interfaces:**
- Consumes: the routes of Task 6; `periodLabel` and the period builders from `@notaflow/invoice-report/period`; `api`, `downloadFile`, `usePolling`; UI kit `Card`, `Field`, `Select`, `DateInput`, `Button`, `Badge`, `Table`, `Alert`.
- Produces: the page. No exports used elsewhere.

Page, as in the approved prototype:
- Title `Relatórios`. Form card: `Emitente` (`Select`, default the first emitter), `Período` as three buttons `Mensal` / `Anual` / `Por período` with `aria-pressed` (no segmented control exists in the kit; build it in the page), then `Mês de competência` (`Select` of the last 24 months, default the previous month in Brasília time), or `Ano` (`Select`, current year and the 5 years before it), or `De` and `Até` (`DateInput`). Button `Gerar PDF`. While the POST runs, the button says `Gerando…` and is disabled.
- History table: Emitente, Período (`periodLabel`), Pedido por (name and `dd/mm hh:mm`), Notas, Situação, and an action. Status badges: `pending` = `Na fila`, `running` = `Gerando…`, `ready` = `Pronto` + `Baixar`, `failed` = `Falhou` + `Tentar de novo`, `expired` = `Expirado`. 20 per page with the same pager as InvoicesPage.
- Poll with `usePolling(hasOpen, reload, loading)`, where `hasOpen` = any row `pending` or `running`.
- Errors in an `Alert` above the table: `report_too_large` = `O período tem mais de 20.000 notas. Escolha um período menor.`; `too_many_requests` = `Limite de 10 relatórios por hora. Tente de novo mais tarde.`; `period_too_long` = `O período pode ter no máximo 366 dias.`; `reports_unavailable` and anything else = the generic error used on other pages.

- [ ] **Step 1: Write the failing tests** in `ReportsPage.test.tsx` (`// @vitest-environment jsdom`, `stubApi`, `renderWithMe`, fake timers as in `pdfPolling.test.tsx`):
  - `posts a monthly report for the previous month`: with the clock at 2026-11-06, clicking `Gerar PDF` posts `{ emitterId, period: 'month', month: '2026-10' }`.
  - `posts a range`: `Por período`, dates 01/07/2026 and 30/09/2026, posts `{ period: 'range', from: '2026-07-01', to: '2026-09-30' }`.
  - `polls while a report is open and stops when ready`: the list answers `running`, then `ready`; after 3 s a second GET happens; the row shows `Baixar`.
  - `shows the too-large message` on 422 `report_too_large`.
  - `retries a failed report`: clicking `Tentar de novo` posts to `/retry`.
  - `router.test.ts`: `/app/<id>/relatorios` parses to `{ name: 'reports', accountId }` and back.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/pages/ReportsPage.test.tsx apps/web/src/router.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, menu item, page, and API types.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build:web`. Expected: all pass. Run `pnpm dev:server` and `pnpm dev:web` with `pnpm fake:nacional`, create a report on the fake, download it, and take screenshots of the page and the PDF for the PR.
- [ ] **Step 5: Commit** `feat(web): add the Reports page`.

---

### Task 8: C4 diagrams, alert, docs, and the sample check

**Files:**
- Modify: `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-2-containers.mmd` and `.png` (server description adds "invoice reports"; R2 description adds "report PDFs, 1 year"; the server to R2 edge adds "report PDFs")
- Modify: `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-3-server-components.mmd` and `.png` (component `reports` = "Invoice reports [routes/reports, reports/ReportRunner, packages/invoice-report, worker threads]: Draws the report PDF of one emitter and period in a worker thread, keeps it 1 year in R2."; edges routes to reports, reports to repos, reports to r2; R2 node text adds "report PDFs")
- Modify: `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md` (the packages list gains `invoice-report`)
- Modify: the Grafana alert rules file that holds the DANFSe DLQ alert (find it with `git grep -n danfse deploy/`): alert `ReportPendingTooLong` when `report_oldest_pending_seconds > 600` for 5 minutes, to Discord.
- Modify: `docs/ENGINEERING/RFCS/2026/11/RFC_INVOICE_REPORT.md` (status line: implemented on `feat/invoice-report`)

- [ ] **Step 1:** Edit both `.mmd` files. Render each PNG as `docs/ENGINEERING/ARCHITECTURE/diagrams/README.md` says (`python -m http.server 4181 --bind ::1`, `render.html?file=<name>.mmd`, node screenshot of `#out`).
- [ ] **Step 2:** Add the alert rule. Validate the file the same way the DANFSe alert PR did (see `docs/TUTORIALS/DANFSE_QUEUE.md`).
- [ ] **Step 3: Sample check.** Ask the owner to run the report for October 2026 of the emitter in the sample (in production after deploy, or on a copy of the data). Every card on page 1 must equal the RFC "Summary formulas" sample column. Record the result in the PR.
- [ ] **Step 4:** Before the merge, add an R2 lifecycle rule on the DANFSe bucket: prefix `reports/`, delete after 366 days. Record it in the PR.
- [ ] **Step 5: Commit** `docs: add invoice reports to the C4 diagrams and the alert`. Open the PR to `production` with the screenshots, the timing, and the sample result. Read the PR number from the `gh pr create` output.
