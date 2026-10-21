# Accounting Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public guide at `/guia` with one path for each regime, shared chapters, a Simples rate calculator that follows the PGDAS-D, a regime check by CNPJ, and a notify-me list.

**Architecture:** Static HTML pages built by Vite next to the landing, with one small build-time include for the shared header and footer. The calculation is pure TypeScript in `@notaflow/provider-nacional` (one source of truth for the server and the browser). The server gets two public endpoints and one platform table.

**Tech Stack:** Vite (multi-page), TypeScript, Fastify, Drizzle on SQLite, Vitest, Playwright for the screenshots and the visual check.

**Spec:** [RFC Accounting Guide](../../../RFCS/2026/10/RFC_ACCOUNTING_GUIDE.md)

## Global Constraints

- Branch `feat/accounting-guide` from `production`. Never `git reset --hard`: the working tree has an uncommitted `.gitignore` line that guards a secret.
- Guide text is Brazilian Portuguese, in the voice of the landing. Code, comments, docs, commits and the PR are English and follow the Writing Style. No em dash anywhere.
- Amounts are integer cents. Rates are integer hundredths of a percent (`simplesRates.ts` convention).
- Each guide page ends with "Fontes", "Atualizado em", and the fixed "Aviso" text: "Este guia explica as regras gerais e não substitui a orientação de um profissional. Em caso de dúvida, consulte um contador de sua confiança."
- A fact without an official source does not go in the guide. If a source disagrees with the code (`simplesRates.ts`, `annexRule.ts`, `format.ts`, the issue rules), stop and report. Do not change the code to match the guide.
- No text says that an ME/EPP does not need an accountant. No text blames the accountant. No partner name (TecnoSpeed, Soluti). No certificate price.
- The calculator sends nothing to the server and stores nothing.
- `waitlist_signups` follows Data: `created`/`touched`, `notDeleted`, `softDelete`, the `_no_delete` trigger.
- Commits and the PR carry no AI attribution. Never `--no-verify`.
- Scripts run on Windows and Linux.

## Review Focus

1. **Money typed in Brazilian format** ("12.345,67", "R$ 1.000", an empty field): the calculator parses it to cents or shows a field error, never NaN or a silent zero. Test in Task 6.
2. **RBT12 exactly on a band limit** (R$ 180.000,00) and **exactly R$ 3.600.000,00 / R$ 4.800.000,00**: the band is the lower one, the sublimit warning starts above 3,6 mi, and the calculation stops only above 4,8 mi. Test in Task 2.
3. **A CNPJ with a mask or bad check digits** in "Não sei": the page accepts "12.345.678/0001-95", and the server answers 400 for bad digits without a lookup. Test in Task 4.
4. **The same e-mail twice with different case or new interests:** one row, merged interests. Test in Task 3.
5. **Zero revenue in the month, or zero RBT12 for a new company:** the result is a DAS of R$ 0,00 or the band 1 nominal rate, never a division by zero. Test in Task 2.

---

### Task 1: Research and the sources file

The content and the IRPJ, CSLL and CPP shares of Task 2 depend on this task.

**Files:**
- Create: `docs/ENGINEERING/RFCS/2026/10/RFC_ACCOUNTING_GUIDE_SOURCES.md`
- Modify: `docs/ENGINEERING/RFCS/2026/10/RFC_ACCOUNTING_GUIDE.md` (a reference to the new file; any section a source contradicts)

**Interfaces:**
- Produces: a table with one row for each fact: `topic | fact | value | source (URL + article) | checked on`. Later tasks cite rows by topic.

- [ ] **Step 1: Create the branch.** `git switch -c feat/accounting-guide production`, then check that `git status` still shows the `.gitignore` change and the RFC files.
- [ ] **Step 2: Research each topic of the RFC "Sources and Accuracy" table** against the current official text (planalto.gov.br, normas.receita.fazenda.gov.br, the Portal do Simples Nacional, gov.br/nfse, gov.br/iti, the Portal do Empreendedor). Minimum facts:
  - Anexos III, IV, V: all the shares of each band, including IRPJ, CSLL, CPP (III, V), and the band 5 ISS cap rule.
  - Art. 18 §5-B, §5-C, §5-D, §5-I, §5-J, §5-M: which activities go to which Anexo, and which use the Fator R.
  - Art. 18 §24: the items of the Fator R payroll.
  - Art. 18 §1, §2 and Res. CGSN 140 art. 22: the RBT12 window and the proportional rule for a new company.
  - The ISS retained and export removal in the PGDAS-D (Res. CGSN 140 and the PGDAS-D manual).
  - The R$ 3,6 mi sublimit (art. 13-A), the R$ 4,8 mi limit, and the fixed ISS of professional societies.
  - MEI: the current revenue limit, the activities, the fixed DAS, desenquadramento, and how a MEI issues an NFS-e.
  - Lucro Presumido: the presumption rates for services, PIS/COFINS cumulative rates.
  - INSS retained 11% (Lei 8.212 art. 31), ISS 2% to 5% (LC 116), A1/A3 and ICP-Brasil (ITI), IBS/CBS calendar (LC 214/2025).
  - Up to three worked examples from an official source, for the tests of Task 2.
- [ ] **Step 3: Compare with the code.** Check each band of `packages/provider-nacional/src/rules/simplesRates.ts` and each prefix of `apps/server/src/data/annexRule.ts` against the sources. Write each difference in a "Differences" section. If there is one, stop and report to the owner before Task 2.
- [ ] **Step 4: Fix the RFC** where a source contradicts it, and add the sources file to its References.
- [ ] **Step 5: Commit** the RFC, the sources file, and this plan: `docs: accounting guide RFC, plan, and checked sources`.

---

### Task 2: The Simples calculation, shared by the server and the browser

**Files:**
- Modify: `packages/provider-nacional/src/rules/simplesRates.ts` (IRPJ, CSLL, CPP shares; export `simplesShares`)
- Create: `packages/provider-nacional/src/rules/simplesMonth.ts`
- Move: `apps/server/src/data/annexRule.ts` to `packages/provider-nacional/src/rules/annexRule.ts` (update its server imports)
- Create: `packages/provider-nacional/src/simples.ts` (browser entry: re-exports only these three modules)
- Modify: `packages/provider-nacional/package.json` (`"./simples": "./src/simples.ts"` in `exports`), `apps/web/package.json` (`"@notaflow/provider-nacional": "workspace:*"`)
- Test: `packages/provider-nacional/src/rules/simplesMonth.test.ts`, the existing `simplesRates` tests

**Interfaces:**
- Produces (all from `@notaflow/provider-nacional/simples`):
  - `type SimplesTax = 'irpj' | 'csll' | 'cofins' | 'pis' | 'cpp' | 'iss' | 'icms' | 'ipi'`
  - `simplesShares(annex: SimplesAnnex, rbt12Cents: number): { band: number; nominalRate: number; deductionCents: number; effectiveRate: number; taxes: Partial<Record<SimplesTax, number>>; issCapped: boolean }` (rates in hundredths; `taxes` are the parts of `effectiveRate` and add up to it, ±1)
  - `type RevenueKind = 'normal' | 'iss_retained' | 'export'`
  - `rbt12Window(input: { month: string; activityStart: string; revenues: Record<string, number> }): { rbt12Cents: number; rule: 'full' | 'first_month' | 'proportional'; months: string[] }` (months as `YYYY-MM`)
  - `fatorR(input: { payroll: { salaries: number; proLabore: number; fgts: number; cpp: number; other: number }; rbt12Cents: number }): { ratioHundredths: number; annex: 'III' | 'V' }`
  - `simplesMonth(input: { rbt12Cents: number; lines: { annex: SimplesAnnex; kind: RevenueKind; revenueCents: number }[] }): { lines: { annex: SimplesAnnex; kind: RevenueKind; revenueCents: number; rate: number; dasCents: number; taxes: Partial<Record<SimplesTax, number>> }[]; totalCents: number; warnings: ('over_sublimit' | 'iss_cap')[] }`. It throws `RangeError` above R$ 4,8 mi, as `simplesRate` does.
  - `annexRule` and `AnnexRule`, unchanged.

- [ ] **Step 1: Write the failing tests** in `simplesMonth.test.ts`:
  - `simplesShares('III', 18_000_000)`: band 1, `effectiveRate` 600, the taxes add up to 600.
  - Every band of every Anexo: the shares add up to 10000 (100%) before the effective rate (a table test over `SIMPLES_ANNEXES` × 6).
  - `simplesShares('III', 18_000_001).band === 2`; `simplesShares('III', 360_000_000)` has no `over_sublimit`; 360_000_001 has it; 480_000_001 throws.
  - `rbt12Window` with a 14-month history: `rule: 'full'`, the 12 months before `month`, not `month` itself.
  - `rbt12Window` with `activityStart === month`: `rule: 'first_month'`, revenue of the month × 12.
  - `rbt12Window` in month 3 of activity: `rule: 'proportional'`, the average of months 1 and 2 × 12.
  - `fatorR` at exactly 28,00%: `annex: 'III'`; at 27,99%: `'V'`.
  - `simplesMonth` with one `iss_retained` line in Anexo III band 1: `rate` = 600 minus the ISS share; with an `export` line: the same as `simplesRate(..., { export: true })`.
  - `simplesMonth` with two lines in Anexos III and IV: each line uses its own Anexo and the same RBT12; `totalCents` is the sum.
  - `simplesMonth` with `revenueCents: 0` and with `rbt12Cents: 0`: no throw, `dasCents` 0 and band 1 nominal rate.
  - The worked examples of Task 1, with their source in a comment.
- [ ] **Step 2: Run** `pnpm vitest run packages/provider-nacional/src/rules` and check the failure (missing exports).
- [ ] **Step 3: Add the IRPJ, CSLL and CPP shares** to `TABLES` from the sources file. Keep `simplesRate` and `simplesIssRate` results unchanged (the existing tests prove it).
- [ ] **Step 4: Implement** `simplesShares`, `rbt12Window`, `fatorR`, `simplesMonth`. The removal for `iss_retained` takes out the ISS part (5% when capped); `export` reuses the existing export logic.
- [ ] **Step 5: Move `annexRule`** and update its imports in `apps/server`. Add the `./simples` export and the web dependency, then `pnpm install`.
- [ ] **Step 6: Run** `pnpm vitest run packages/provider-nacional apps/server` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(simples): the month calculation of the PGDAS-D, shared with the browser`.

---

### Task 3: The notify-me table and repository

**Files:**
- Modify: `apps/server/src/db/schema.ts` (table `waitlistSignups`, as in the RFC Data Model; timestamps with `createdAt()`, `changedAt()`, `authors()`, `removal()`)
- Create: `apps/server/drizzle/0020_waitlist.sql` (`pnpm --filter @notaflow/server exec drizzle-kit generate --name waitlist`, then add the `waitlist_signups_no_delete` trigger like the other tables)
- Create: `apps/server/src/repos/WaitlistRepository.ts`
- Test: `apps/server/src/repos/waitlist.repos.test.ts`

**Interfaces:**
- Produces:
  - `type WaitlistInterest = 'mei' | 'lucro_presumido' | 'certificate'`
  - `class WaitlistRepository { constructor(db: Database); signUp(input: { email: string; interests: WaitlistInterest[]; sourcePage: string; campaign: string | null }): void; list(ctx: AdminContext): { id: string; email: string; interests: WaitlistInterest[]; sourcePage: string; createdAt: Date }[]; counts(ctx: AdminContext): Record<WaitlistInterest, number>; remove(ctx: AdminContext, id: string): boolean }`
  - `signUp` has no context: the writer is the public (actor `null`).

- [ ] **Step 1: Write the failing tests:** `signUp` lowercases and trims the e-mail; a second `signUp` with `A@x.com` and a new interest keeps one row with both interests and the first `sourcePage`; `remove` then `signUp` again creates a new row; `list` and `counts` skip removed rows; a raw `DELETE` fails (the trigger).
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/repos/waitlist.repos.test.ts`. Expected: FAIL.
- [ ] **Step 3: Add the table, the migration and the trigger, and implement the repository.**
- [ ] **Step 4: Run** the test and `apps/server/src/db/migrations.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): the notify-me list table`.

---

### Task 4: Public endpoints and the admin list

**Files:**
- Create: `apps/server/src/routes/guide.ts` (both public routes)
- Create: `apps/server/src/auth/turnstileVerify.ts`, `apps/server/src/rateLimit.ts`
- Modify: `apps/server/src/auth/authHook.ts` (skip the two routes), `apps/server/src/routes/admin.ts` (waitlist list and remove), `apps/server/src/app.ts` (wiring)
- Test: `apps/server/src/routes/guide.test.ts`, `apps/server/src/routes/routeSweep.test.ts`

**Interfaces:**
- Consumes: `lookupCnpj` from `src/onboarding/cnpjLookup.ts`, `WaitlistRepository` (Task 3).
- Produces:
  - `GET /api/public/cnpj-regime/:cnpj` → `200 { regime: 'mei' | 'simples' | 'other' }`; `400 invalid_cnpj`; `404 cnpj_not_found`; `503 cnpj_lookup_unavailable`; `429 too_many_requests`. `cnpj_not_active` answers `200 { regime: 'other' }`.
  - `POST /api/public/waitlist` with `{ email, interests, sourcePage, campaign?, turnstileToken }` → `204`; `400 invalid_body`; `403 bad_origin`; `403 captcha_failed`; `429 too_many_requests`.
  - `GET /api/admin/waitlist` → `{ signups, counts }`; `DELETE /api/admin/waitlist/:id` → `204`.
  - `createRateLimiter(options: { windowMs: number; max: number }): (key: string, now?: number) => boolean` (in memory, per process).
  - `verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean>` (POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with undici).

- [ ] **Step 1: Write the failing tests** in `guide.test.ts` (use `createTestApp`, a `MockAgent` for BrasilAPI and Turnstile as in `turnstile.test.ts`):
  - `GET /api/public/cnpj-regime/12.345.678%2F0001-95` with no session: 200, and the body has only the `regime` key.
  - A CNPJ with bad check digits: 400, and the mock saw no request.
  - `opcao_pelo_mei: true` → `mei`; `opcao_pelo_simples: true` → `simples`; neither → `other`.
  - The 31st request from one IP in an hour: 429 (`max: 30`).
  - `POST /api/public/waitlist` with a good token: 204 and one row; a bad token: 403 `captcha_failed`; another origin: 403 `bad_origin`; an interest outside the list: 400.
  - Without Turnstile configured (dev), the POST skips the check, as signup does.
  - `GET /api/admin/waitlist` as a normal user: 404; as admin: the list and the counts.
- [ ] **Step 2: Add `/api/admin/waitlist/:id` to the route sweep** and run all three tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The waitlist POST checks the origin and the JSON content type itself, because the auth hook skips it. Rate limits: CNPJ 30 an hour, waitlist 10 an hour, keyed by `request.ip`.
- [ ] **Step 4: Run** `pnpm vitest run apps/server`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): regime by CNPJ and the notify-me list, public and rate limited`.

The architecture has no new container or external system (the CNPJ lookup already exists), so the C4 diagrams do not change.

---

### Task 5: Guide shell: pages, routes, shared header and footer

**Files:**
- Create: `apps/web/partials/guide-header.html`, `apps/web/partials/guide-footer.html` (the footer holds "Atualizado em" as a slot, the "Aviso", and the landing footer links)
- Create: one file per page in `apps/web/guia/`: `index.html`, `mei.html`, `simples-nacional.html`, `primeira-nota.html`, `rotina-do-mes.html`, `lucro-presumido.html`, `calculadora-simples.html`, `certificado-digital.html`, `preciso-de-contador.html`, `glossario.html`, `reforma-tributaria.html` (title, description, canonical, og tags, JSON-LD `Article` + `BreadcrumbList`, the include markers, and a placeholder `<main>`)
- Create: `apps/web/src/site/guide/guide.ts`, `apps/web/src/site/guide/guide.css`
- Modify: `apps/web/vite.config.ts` (the 11 inputs; a plugin `htmlPartials()` with `transformIndexHtml` that replaces `<!--partial:guide-header-->` and `<!--partial:guide-footer-->`), `apps/server/src/web.ts` (`STATIC_PAGES` entries `/guia` → `guia/index.html`, `/guia/mei` → `guia/mei.html`, ...)
- Test: `apps/web/src/site/staticPages.test.ts`, `apps/server/src/web.test.ts`

**Interfaces:**
- Produces: `GUIDE_PAGES: { path: string; file: string; title: string }[]` exported from `apps/web/src/site/guide/pages.ts`, read by the tests and the hub.

- [ ] **Step 1: Write the failing tests:**
  - `staticPages.test.ts`: add the guide pages and the partials to `PAGES`, and the guide paths to `ROUTES`. Each guide page has one JSON-LD block with `Article` and `BreadcrumbList`, a canonical that matches its path, and both include markers.
  - The footer partial contains the exact "Aviso" text of the Global Constraints.
  - `web.test.ts`: `GET /guia/mei` serves the built page, and `/sitemap.xml` lists every `GUIDE_PAGES` path.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/site apps/server/src/web.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the plugin, the pages, `guide.ts` (imports `../site` so the theme, analytics and campaign carry work), and the routes.
- [ ] **Step 4: Run** the tests and `pnpm build:web`, then check that `apps/web/dist/guia/mei.html` has the header and footer and no marker left.
- [ ] **Step 5: Commit:** `feat(web): guide pages, routes, and the shared header and footer`.

---

### Task 6: Hub, regime check, notify-me form, and the calculator

**Files:**
- Create: `apps/web/src/site/guide/money.ts`, `apps/web/src/site/guide/annexQuestions.ts`, `apps/web/src/site/guide/calculator.ts`, `apps/web/src/site/guide/cnpjCheck.ts`, `apps/web/src/site/guide/waitlist.ts`
- Modify: `apps/web/guia/index.html`, `apps/web/guia/calculadora-simples.html`, the three pages with the form, `apps/web/src/analytics/analytics.ts` (events `guide_path`, `guide_cnpj_regime`, `guide_calculator`, `waitlist_signup`)
- Test: `apps/web/src/site/guide/money.test.ts`, `annexQuestions.test.ts`, `calculator.test.ts` (jsdom), `waitlist.test.ts` (jsdom)

**Interfaces:**
- Consumes: `@notaflow/provider-nacional/simples` (Task 2), the endpoints of Task 4.
- Produces:
  - `parseMoney(text: string): number | null` (cents; accepts "1.234,56", "1234,56", "R$ 1.234", "1234"; null for an empty or bad field)
  - `ANNEX_QUESTIONS: { id: string; text: string; help: string; law: string }[]` and `annexFromAnswers(answers: Record<string, boolean | undefined>): { result: 'III' | 'IV' | 'V' | 'fator_r'; law: string } | { result: 'undecided' }`. The questions and the law references come from the sources file.
  - `mountCalculator(root: HTMLElement): void`, `mountCnpjCheck(root: HTMLElement): void`, `mountWaitlist(form: HTMLFormElement): void`

- [ ] **Step 1: Write the failing tests:**
  - `parseMoney`: "12.345,67" → 1234567; "R$ 1.000" → 100000; "" → null; "abc" → null; "1,5" → 150.
  - `annexFromAnswers`: labor assignment in a §5-C activity → `IV`; an intellectual activity of §5-I → `fator_r`; contradictory or missing answers → `undecided`. Each result carries a `law` text.
  - Calculator (jsdom): fill one normal line of R$ 10.000,00, an RBT12 history of 12 × R$ 10.000,00, Anexo III: the page shows "6,00%" and the DAS "R$ 600,00", and the formula with the numbers. A bad money field shows a field error and no result. With the CNAE hint the page shows "sugestão: confirme com seu contador". With RBT12 above R$ 4,8 mi, the page shows the exit text and no result. The "Tenho mais de uma atividade" section is closed by default.
  - Comparison: "pago hoje" of 8,00% on R$ 10.000,00 shows "R$ 200,00" and the neutral text of the RFC.
  - The calculator makes no `fetch` call (spy on `fetch`).
  - Waitlist (jsdom): the interest of the page is checked by default; a submit posts the JSON of Task 4 and shows the thanks text; a 429 shows "Muitas tentativas. Tente de novo mais tarde."
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/site/guide`. Expected: FAIL.
- [ ] **Step 3: Implement.** Turnstile on the static page loads `https://challenges.cloudflare.com/turnstile/v0/api.js` with the site key from `/api/public/config`. The CNPJ check maps `mei`, `simples` and `other` to the paths and the `other` text of the RFC. Analytics events send no amounts.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): guide hub, regime check, notify-me form, and the Simples calculator`.

---

### Task 7: Content of the shared chapters

**Files:**
- Modify: `apps/web/guia/certificado-digital.html`, `preciso-de-contador.html`, `glossario.html`, `reforma-tributaria.html`

- [ ] **Step 1: Write each page** from the RFC "Content" section and the sources file. Each fact cites a row of the sources file in the page "Fontes". The certificate page ends with "Em breve: compre seu certificado pelo NotaFlow" and the form. The glossary terms have anchors (`id="rbt12"`, ...).
- [ ] **Step 2: Check the anti-goals** with a search over the four files: no "não precisa de contador", no "seu contador errou", no partner name, no "R$" next to the word certificado. Expected: no match.
- [ ] **Step 3: Run** `pnpm vitest run apps/web/src/site`. Expected: PASS (links, titles, markers).
- [ ] **Step 4: Commit:** `feat(guide): certificate, accountant, glossary, and tax reform chapters`.

---

### Task 8: Content of the regime paths and the first invoice

**Files:**
- Modify: `apps/web/guia/index.html`, `mei.html`, `simples-nacional.html`, `primeira-nota.html`, `rotina-do-mes.html`, `lucro-presumido.html`
- Create: `apps/web/public/guia/*.webp` (screenshots), `scripts/guide-screenshots.mjs`

- [ ] **Step 1: Write each path page** from the RFC and the sources file. MEI and Lucro Presumido carry the "em breve" text and the form. Simples ends with "Crie sua conta e emita sua primeira nota" and links to `/guia/primeira-nota` and the calculator.
- [ ] **Step 2: Write `primeira-nota.html`** field by field in the order of `apps/web/src/pages/NewInvoicePage.tsx` and `FiscalConfigForm.tsx`. Read the labels from the code, not from memory.
- [ ] **Step 3: Take the screenshots** with `scripts/guide-screenshots.mjs` (Playwright against `pnpm dev:server` + `pnpm fake:nacional`, synthetic data from `@notaflow/test-kit`, light theme, 1200 px wide, WebP). No real CNPJ, name or certificate.
- [ ] **Step 4: Run** the anti-goal search of Task 7 on these files and `pnpm vitest run apps/web/src/site`. Expected: no match, PASS.
- [ ] **Step 5: Commit:** `feat(guide): regime paths, the first invoice, and the monthly routine`.

---

### Task 9: Entry points, privacy, and the notice

**Files:**
- Modify: `apps/web/landing.html` (a "Guia" link in the header and the footer), `apps/web/src/pages/onboarding/steps.tsx` (a link "Não tenho certificado A1: veja como conseguir" to `/guia/certificado-digital` under the file input), `apps/web/src/components/Layout.tsx` (`emitter_not_simples`: "Este emitente não é ME/EPP do Simples Nacional. O NotaFlow ainda não emite para MEI e outros regimes; veja em notaflow.vapulab.com/guia quando isso muda."), `apps/server/src/mail/templates.ts` (the two certificate reminders link to `/guia/certificado-digital`), `apps/web/public/llms.txt`, `apps/web/privacidade.html` (a paragraph on the notify-me list), `apps/server/src/legal.ts` (a new `POLICY_NOTICE`, `LEGAL_VERSION` unchanged), `apps/web/src/pages/AdminPage.tsx` (a "Lista de espera" section: counts by interest, the list, and "Remover" with a confirm, from the Task 4 admin endpoints)
- Test: `apps/web/src/pages/AdminPage.test.tsx`, `apps/web/src/pages/onboarding.test.tsx`, `apps/server/src/mail` tests, `staticPages.test.ts`, `apps/server/src/routes/policyNotice.test.ts`

- [ ] **Step 1: Write the failing tests:** the admin page shows the waitlist counts and rows, and "Remover" calls `DELETE /api/admin/waitlist/:id`; the certificate step has a link to `/guia/certificado-digital`; both reminder e-mails contain `https://notaflow.vapulab.com/guia/certificado-digital`; the landing links to `/guia`; `POLICY_NOTICE.id` is `2026-10-21-waitlist` and its `href` is `/privacidade`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** If `feat/certificate-help` merged first, put the link inside its `<details>` instead of under the input.
- [ ] **Step 4: Run** `pnpm vitest run apps/web apps/server`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(guide): link the guide from the landing, onboarding, errors and e-mails`.

---

### Task 10: Verification and the PR

- [ ] **Step 1: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build:web`. Expected: all pass.
- [ ] **Step 2: Visual check** with Playwright on `pnpm dev:server`: every guide page at 375 px and 1280 px, light and dark. No horizontal scroll, the hub cards stack on a phone, the calculator works on a phone.
- [ ] **Step 3: Check every outside link** of the guide pages answers 200 (a script, not by hand), and every page has a "Fontes" entry.
- [ ] **Step 4: Open the PR** to `production` with `gh pr create`. Read the number from its output. The PR body lists the points the owner must read: the full guide text, the sources file, and any "Differences" row. The owner reads the full text before the merge.
