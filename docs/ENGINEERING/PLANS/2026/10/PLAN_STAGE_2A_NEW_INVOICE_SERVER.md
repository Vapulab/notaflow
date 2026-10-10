# Stage 2a (New Invoice Without a Template: Server and Provider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server issue an NFS-e without a template invoice: emitter fiscal configuration, services, customers created by hand, a `buildTemplate` that produces the same `DpsTemplate` as `readTemplate`, tax rules by competence, and `POST /invoices/new` on the existing issue path. The screens are Stage 2b.

**Architecture:** `packages/provider-nacional` gains `simplesBands`, `taxRules(competence)`, and `buildTemplate(input) → DpsTemplate`. The core `InvoiceIssuer` port gains `buildTemplate(input: NewInvoiceInput): string` (an opaque JSON of the provider's template) and an `IssueRequest` that carries either the stored template XML or that built JSON. The server stores the built JSON on the pending row (`invoices.issue_template`) in the reservation transaction, so reconcile and resends use exactly what was first sent. Everything after the template (reservation, pending row, send, E0014 ownership check, reconcile, idempotency, cancel) is unchanged.

**Tech Stack:** TypeScript, Vitest 5, Fastify 5, Drizzle 0.45 with SQLite, the XSD validator in `tools/xsd`, the fake national system.

**Spec:** [RFC: New Invoices Without a Template](../../RFCS/2026/10/RFC_NEW_INVOICE.md). Background: [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), [Invoice Lifecycle](../../ARCHITECTURE/INVOICE_LIFECYCLE.md).

## Global Constraints

- Every issued test invoice in produção restrita is cancelled afterwards, and the task ends with the list of issued and cancelled invoices (numbers only).
- No real invoice data, real CNPJ, customer name, or amount enters the repository; tests use synthetic data (`12345678000195`, `98765432000110`, valid synthetic CPFs).
- Percents are integers in hundredths (6.00% = 600), amounts are integer cents; the XML gets `"6.00"`-style strings only at the builder.
- Every DPS the builder writes validates against `DPS_v1.01.xsd` in a test.
- Every account query goes through a repository that takes an `AccountContext`; owner-only writes use the existing guards; every new route is in the route sweep.
- `rules2026` only; the 2027 IBS/CBS highlight is out of scope (RFC "Non-goals").
- Commits carry no AI attribution; never `--no-verify`; on Lincoln's machine add the gitleaks folder to `PATH` before committing; never run Prettier on `apps/web/src/malphas/` (it is in `.prettierignore`).
- PRs target `production`, which deploys on merge.

## Review Focus

1. A resend or reconcile of an invoice issued without a template after its customer or service was edited. Expected: the resend uses the stored `issue_template`, byte for byte the same fiscal content. Pinned in Task 7.
2. A Brazil customer with a CPF whose check digits are wrong, or without municipality or CEP. Expected: 400 with its own code, before any DPS number is reserved. Pinned in Task 6.
3. A foreign customer on a domestic-rules path, or the reverse. Expected: the customer's country alone picks the rules (export immune vs taxable). Pinned in Task 2.
4. An emitter without a fiscal configuration. Expected: 409 `fiscal_config_missing`, nothing reserved. Pinned in Task 7.
5. Imported services from synced invoices: the same service code and description twice gives one service, and a service edited by hand is not overwritten. Pinned in Task 5.

---

## File Structure

```
packages/core/src/ports/InvoiceIssuer.ts            NewInvoiceInput, IssueRequest.source, buildTemplate
packages/provider-nacional/src/rules/simplesBands.ts Annex III and V band percents
packages/provider-nacional/src/rules/taxRules.ts     taxRules(competence) -> rules2026
packages/provider-nacional/src/template/buildTemplate.ts NewInvoiceInput -> DpsTemplate
packages/provider-nacional/src/NacionalIssuer.ts     buildTemplate, source-aware issue and dpsId
apps/server/src/db/schema.ts + drizzle/0004_*.sql    emitter fiscal columns, services, invoices.issue_template
apps/server/src/repos/ServiceRepository.ts
apps/server/src/repos/EmitterRepository.ts           fiscal config get and set
apps/server/src/repos/CustomerRepository.ts          createManual
apps/server/src/domain/documents.ts                  CPF and CNPJ check digits
apps/server/src/routes/fiscal.ts, services.ts         new routes
apps/server/src/routes/customers.ts                   POST customers
apps/server/src/issue/IssueService.ts                 issueNew, reconcile with issue_template
apps/server/src/routes/issue.ts                       POST invoices/new
spikes/2026-10-new-invoice/run.ts                     produção restrita check (Task 1)
```

---

### Task 1: Produção restrita check (domestic Simples invoice with ISS, export built without a template)

**Why first:** the RFC's first open question (does the Sefin accept `pAliq` for an ME/EPP Simples optant, and with which `tribISSQN`) decides `rules2026`.

**Files:** Create `spikes/2026-10-new-invoice/run.ts`; root `package.json` script `"spike:new-invoice": "tsx --env-file=.env.local spikes/2026-10-new-invoice/run.ts"`.

- [ ] **Step 1:** Write the script with `buildDpsXml` directly (no template), the Node signer (`rsa-sha256-exc-c14n`), and `NacionalClient` for `producao_restrita`, reusing `spikes/2026-10-sefin/session.ts` (certificate, client, `cancelInvoice`). It issues, in order, each variant below once, records `{variant, kind, accessKey?, errors?}` to `spikes/2026-10-new-invoice/results.local.json` (gitignored like the Stage 0 results), and then cancels every issued one with reason 9:
  - `domestic-iss`: emitter from `.env.local` (municipality, Simples 3, regime 1), a synthetic Brazil customer CNPJ `98765432000110` with an address in the emitter's municipality, `tribISSQN` 1, `tpRetISSQN` 1, `pAliq` "2.00", `pTotTribSN` "6.00", service `010701` with the emitter's NBS, amount R$ 10,00, no IBSCBS group.
  - `domestic-no-aliq`: the same without `pAliq` (only if `domestic-iss` was rejected for `pAliq`).
  - `export-built`: the export shape of the emitter's real export invoice (country US, NIF, `comExt` with mode 1, `tribISSQN` 3, `cPaisResult` US, IBSCBS CST 410 class 410027), amount US$ 1,00, built field by field.
- [ ] **Step 2:** Lincoln's go is the condition to run it (real certificate, produção restrita). Run `pnpm spike:new-invoice`. If the synthetic customer CNPJ is refused as unknown, stop and ask Lincoln for a customer he can use in produção restrita.
- [ ] **Step 3:** Record the outcome in the RFC (new section "Produção restrita check (Stage 2a)"): which variant was accepted, the refusal codes, the issued and cancelled counts. Update `rules2026` expectations in Task 2 from it (ledger ruling if they differ from the table in the RFC).
- [ ] **Step 4:** Commit `spikes/2026-10-new-invoice/run.ts`, the script entry, and the RFC section (`docs: produção restrita check for invoices without a template`).

### Task 2: Simples bands, tax rules, and `buildTemplate`

**Files:** Create `packages/provider-nacional/src/rules/simplesBands.ts`, `rules/taxRules.ts`, `template/buildTemplate.ts`, and their tests; export from `src/index.ts`; add `NewInvoiceInput` to `packages/core/src/ports/InvoiceIssuer.ts`.

**Interfaces:**

```ts
// core
export interface NewInvoiceInput {
  competence: string; // YYYY-MM-DD
  emitter: {
    cnpj: string;
    municipality: string;
    municipalRegistration?: string;
    phone?: string;
    email?: string;
    simplesNacional: '1' | '2' | '3';
    simplesRegime?: '1' | '2' | '3';
    specialRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  };
  service: {
    nationalTaxCode: string;
    municipalTaxCode?: string;
    nbsCode?: string;
    description: string;
    pisCofinsCst?: string;
    ibsCbs?: { operationCode: string; cst: string; classCode: string };
    export?: {
      mode: '0' | '1' | '2' | '3' | '4';
      providerLink: '0' | '1' | '2' | '3' | '4' | '5' | '6';
      providerSupport: string;
      customerSupport: string;
      temporaryGoods: '0' | '1' | '2' | '3';
      mdic: '0' | '1';
    };
  };
  customer: InvoiceParty; // document must not be null for a Brazil customer
  serviceCents: number;
  foreign?: { currencyCode: string; amountCents: number }; // BACEN code, e.g. 220
  simplesPercent: number; // hundredths
  issRate?: number; // hundredths; ignored for a customer abroad
  issRetained?: boolean; // complete mode; default false
}
```

```ts
// provider-nacional
export const SIMPLES_BANDS: Record<'III' | 'V', number[]>; // hundredths
export function percentText(hundredths: number): string; // 600 -> "6.00"
export interface RuleSet { forCustomer(abroad: boolean): { issqnTaxation: '1' | '3'; usesIssRate: boolean; foreignTrade: boolean } }
export function taxRules(competence: string): RuleSet; // rules2026 for every date before 2027-01-01; throws for later dates until the 2027 stage
export function buildTemplate(input: NewInvoiceInput): DpsTemplate;
```

- [ ] **Step 1: Failing tests.**
  - `simplesBands.test.ts`: Annex III is `[600, 1120, 1350, 1600, 2100, 3300]`, Annex V `[1550, 1800, 1950, 2050, 2300, 3050]`; `percentText(600)` is `"6.00"`, `percentText(1120)` `"11.20"`.
  - `taxRules.test.ts`: `taxRules('2026-10-31').forCustomer(false)` is taxable with ISS rate, no foreign trade; `forCustomer(true)` is export (`'3'`), no ISS rate, foreign trade; `taxRules('2027-01-01')` throws `/2027/`.
  - `buildTemplate.test.ts`: a Brazil CNPJ customer gives `tax.issqnTaxation '1'`, `issRatePercent '2.00'`, `issRetention '1'`, `simplesTotalPercent '6.00'`, the customer address domestic, no `foreignTrade`; a CPF customer gives `customer.document.type 'CPF'`; a foreign customer gives `'3'`, `resultCountry` the country, no `issRatePercent`, `foreignTrade` with `amountInCurrencyCents` from `foreign`; `issRetained: true` gives `issRetention '2'`. For each, `buildDpsXml({ ...template-derived input })` validates against `DPS_v1.01.xsd` (reuse `test/xsd.ts`). Round trip: wrapping the built DPS in the `NFSe` envelope of `NFSE_EXPORT_FULL.xml` and `readTemplate` gives back the same template.
- [ ] **Step 2:** Run `pnpm vitest run packages/provider-nacional/src/rules packages/provider-nacional/src/template` → FAIL (modules missing).
- [ ] **Step 3:** Implement. The customer is abroad when its address is `foreign` or its document is `NIF` or null. Domestic customers need a `domestic` address. The Brazil branch writes `pAliq` only when `rules.usesIssRate` and `issRate` is set (Task 1 may change this: follow the ledger ruling).
- [ ] **Step 4:** Run the package suite, typecheck, lint → PASS. Commit `feat(provider-nacional): Simples bands, tax rules by competence, and buildTemplate`.

### Task 3: The issuer takes a built template

**Files:** Modify `packages/core/src/ports/InvoiceIssuer.ts`, `packages/provider-nacional/src/NacionalIssuer.ts`, `packages/fake-nacional/src/issuer.e2e.test.ts`.

**Interfaces:**
- `IssueRequest.templateXml` becomes `source: { kind: 'stored'; xml: string } | { kind: 'built'; template: string }` (the built template is the opaque JSON from `buildTemplate`).
- `InvoiceIssuer.buildTemplate(input: NewInvoiceInput): string` and `dpsId(series, number, source)` (same union).

- [ ] **Step 1:** Update the e2e test first: the existing tests pass `source: { kind: 'stored', xml }`; a new test builds a Brazil invoice with `issuer.buildTemplate(...)`, issues it on the fake, and finds it by `issuer.dpsId(series, number, source)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`JSON.stringify`/`JSON.parse` of `DpsTemplate`; `readTemplate` for `stored`). Update every caller in `apps/server` (IssueService) to pass `{ kind: 'stored', xml }`. **Step 4:** `pnpm test`, typecheck, lint → PASS. Commit `feat: the issuer issues from a stored or a built template`.

### Task 4: Database: emitter fiscal configuration, services, and the built template on the invoice

**Files:** `apps/server/src/db/schema.ts`, generated `drizzle/0004_*.sql`, `EmitterRepository` (`fiscalConfig`, `setFiscalConfig`), new `ServiceRepository`, `InvoiceRepository.createPending` (`issueTemplate?: string`), `issueState` (adds `issueTemplate`).

Columns and table exactly as in the RFC "Data Model"; `services` has a unique index on `(emitter_id, national_tax_code, description)` for imported services, and `archived` default false.

- [ ] **Step 1:** Repository tests first (`apps/server/src/repos/stage2Repos.test.ts`): fiscal config round trip and account scoping (another account gets null and cannot write); a service create, list (archived hidden), update, archive; `createPending` with `issueTemplate` and `issueState` returning it.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and generate the migration (`pnpm --filter @notaflow/server exec drizzle-kit generate --name stage_2a`). **Step 4:** PASS, commit `feat(server): fiscal configuration, services, and the built template on the invoice`.

### Task 5: Fiscal configuration and services API, imported services, and the service code search

**Files:** `apps/server/src/routes/fiscal.ts`, `routes/services.ts`, `sync/applyDocument.ts`, `apps/server/src/data/serviceCodes.json` (+ a test), route sweep params (`:serviceId`).

- [ ] **Step 1: Tests first.**
  - `GET/PUT emitters/:emitterId/fiscal`: owner writes (annex III band 1 → `simplesPercent` 600 computed by the server from the band; `issRate` 200; regime `inside_das` from `2026-07-01`), member reads but gets 403 `owner_only` on PUT, suspended account 403, another account 404; an audit entry `emitter.fiscal`.
  - Services: create, list, update, archive (owner); member reads.
  - Imported services: syncing two invoices with the same service code and description creates one service with `origin: imported`; a hand edit of its description is kept on the next sync.
  - `GET service-codes?q=software` returns codes whose description matches, at most 20, each `{ code, description }`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **The service code table:** download the official list of national service codes (`cTribNac`, "Lista de Serviços Nacional" in the NFS-e technical documentation on gov.br/nfse, the annex of the current layout), convert it once to `serviceCodes.json` (`[{ code, description }]`), and record its source URL and date in a one-line comment of the loader. If the official file cannot be found or read, ledger a ruling, ship the JSON with the codes of the emitter's own invoices only, and keep the RFC open question open.
- [ ] **Step 4:** PASS, commit `feat(server): fiscal configuration and services, imported from invoices, with the national code search`.

### Task 6: Customers created by hand, with document check digits

**Files:** `apps/server/src/domain/documents.ts` (+ test), `CustomerRepository.createManual`, `routes/customers.ts` (`POST customers`).

- [ ] **Step 1: Tests first.**
  - `isValidCpf('52998224725')` true, `isValidCpf('52998224724')` false, all-equal digits false; `isValidCnpj('12345678000195')` true and `'12345678000190'` false. (`12345678000195` is the synthetic CNPJ the tests already use; check its digits and pick another synthetic one if it fails.)
  - `POST customers`: a Brazil CNPJ customer with address is 201 `origin: manual`; a bad CPF is 400 `invalid_document`; a Brazil customer without municipality or CEP is 400 `customer_address_incomplete`; a foreign customer without country is 400 `customer_country_missing`; a foreign customer with `documentType: NONE` is accepted; a duplicate document for the same emitter is 409 `customer_exists`; a member can create; a suspended account cannot; another account 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, commit `feat(server): create customers by hand, Brazil or abroad`.

### Task 7: `POST /invoices/new` and reconcile with the built template

**Files:** `apps/server/src/issue/IssueService.ts` (`issueNew`), `routes/issue.ts`, tests in `routes/issueNew.test.ts`, `INVOICE_LIFECYCLE.md`.

`issueNew(ctx, actor, input, idempotencyKey?)`:
1. Load the emitter (404), its fiscal configuration (409 `fiscal_config_missing`), the service (404 `service_not_found`, must belong to the emitter), the customer (404 `customer_not_found`, must belong to the emitter); validate the amount, the competence, and a foreign amount for a customer abroad (400 `invalid_amount`).
2. Idempotency as in `issue` (repeat answers 200 with the first row).
3. `template = issuer.buildTemplate(...)` from those records and the request overrides (simplesPercent, issRate, issRetained, description).
4. In the reservation transaction: `createPending` with `issueTemplate: template`, `templateOf: null`, the DPS id from `issuer.dpsId(series, number, { kind: 'built', template })`.
5. Send with `source: { kind: 'built', template }`; `record()` as today (ownership check after E0014 unchanged).

`reconcile`: when `templateOf` is null and `issueTemplate` is set, use `{ kind: 'built', template: issueTemplate }` for the lookup and the resend; never rebuild.

- [ ] **Step 1: Tests first** (on the fake): a Brazil invoice issues and is `issued` with the service description and the ISS rate in its XML; an export invoice with a foreign amount issues with `comExt`; a missing fiscal configuration is 409 and nothing is reserved; the same `Idempotency-Key` twice issues once; a timeout leaves it `unknown`, then the customer's name is edited, and reconcile finds or resends the invoice with the **original** customer name (Review Focus 1).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `pnpm test`, typecheck, lint, build → PASS. Commit `feat(server): issue a new invoice without a template, reconciled from what was sent`.

### Task 8: Docs and the final check

- [ ] Update `INVOICE_LIFECYCLE.md` (issue without a template, `issue_template`), `apps/server/AGENTS.md` (new routes), the RFC (status of the open questions), and `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md` (the `InvoiceIssuer` port change).
- [ ] Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pnpm malphas:check && pytest services/signer-py` → PASS.
- [ ] Commit `docs: invoices without a template`.
