# Stage 2b: New Invoice Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users issue an invoice without a template from the browser. The owner sets up the emitter (fiscal configuration and services), anyone registers a customer, and "Nova nota" issues the invoice in a simplified or a complete mode.

**Architecture:** The server from Stage 2a stays as it is, with three additions: the band table in the fiscal answer, complete-mode overrides on `POST invoices/new`, and a CEP lookup. The web gets an emitter page, an address form shared by every customer screen, a new-customer form, and the "Nova nota" page. The send, review, and result logic of "Emitir parecida" moves into a shared hook, so both issue screens behave the same after an unclear answer.

**Tech Stack:** React 19, Vite 7, Vitest with jsdom and Testing Library, the Malphas components in `apps/web/src/ui`, Fastify 5 and undici on the server.

**Spec:** [RFC_NEW_INVOICE](../../RFCS/2026/10/RFC_NEW_INVOICE.md), sections "Decisions", "Screens", and "Validation and Errors". The server behavior is in [INVOICE_LIFECYCLE](../../ARCHITECTURE/INVOICE_LIFECYCLE.md).

## Global Constraints

- UI text is Brazilian Portuguese; code, comments, and docs are English under the Writing Style, with no em dash.
- Use only the components in `apps/web/src/ui`. Never a raw color. Never edit `apps/web/src/malphas/`.
- Every new API error code has a message in `ERROR_TEXT` (`apps/web/src/components/Layout.tsx`).
- Amounts are integer cents; format them only with `formatCents`, parse them only with `parseCents`. Percents are integer hundredths (6.00% = 600).
- The environment rules of the customer view apply: only a platform admin sees the environment (`showsEnvironment`).
- Owner-only actions (fiscal configuration, services) are disabled for a member, not hidden, with the reason in a tooltip or a line of text, like Membros.
- Every server route goes through the guards and the route sweep (`routeSweep.test.ts`).
- No TypeScript non-null assertions. No AI attribution in commits.

## Decisions (confirmed at plan review)

1. **Complete mode.** The RFC lists service codes, place of service, ISS treatment and retention, PIS/COFINS, IBS/CBS, and export details. This plan adds the per-invoice overrides for the national code (from the code search), the municipal code, NBS, PIS/COFINS CST, IBS/CBS, and the export details (Task 1). **The place of service stays the emitter's municipality.** A different place moves the ISS to another municipality (LC 116, art. 3) and needs rules this plan does not have. It is a later stage if an emitter needs it. Confirmed with Lincoln on 2026-10-10: an export (for example IT services to a US company, done in Brazil) keeps the place of service in the emitter's municipality, and the customer's country goes to `cPaisResult`; Stage 2a already writes it so. Only a service done in person in another municipality, or abroad (`cPaisPrestacao`), changes the place.
2. **CEP.** The address form fills the street, the district, and the IBGE municipality from the CEP through ViaCEP, called by the server (`GET cep/:cep`), so the browser's content policy stays as it is. When ViaCEP is down, the user picks the municipality in the list.
3. **Simples band per invoice.** The band list shows the six bands of the emitter's annex with their percents, and the emitter's band is the default. In complete mode the user can also type another percent.

## Review Focus

1. An unclear answer on "Nova nota" (timeout, 5xx other than `ptax_unavailable`). Expected: the form locks, the same idempotency key is reused on "Tentar de novo", and a reload keeps it, exactly like "Emitir parecida". Pinned in Task 2 and Task 6.
2. `ptax_unavailable` (502) and `amount_ptax_mismatch` (400) on send. Expected: definitive. Nothing was reserved, so the user can go back and edit. The mismatch shows the expected amount and the rate. Pinned in Task 2.
3. A member on the emitter page. Expected: reads the fiscal configuration and the services, and every edit control is disabled with the reason. Pinned in Task 4.
4. A customer abroad picked in "Nova nota". Expected: the currency and foreign amount appear, the BRL amount is read-only from the PTAX of the competence, ISS retention is not offered, and a change of competence fetches the rate again. Pinned in Task 6.
5. An emitter without a fiscal configuration. Expected: "Nova nota" says so before the form. The owner gets a link to the emitter page, and a member is told to ask the owner. Pinned in Task 6.

---

### Task 1: Server additions for the screens

**Files:**
- Modify: `apps/server/src/routes/fiscal.ts`, `apps/server/src/issue/IssueService.ts`, `apps/server/src/routes/issue.ts`
- Create: `apps/server/src/routes/cep.ts`, `apps/server/src/exchange/viaCep.ts` (next to the PTAX client, same undici pattern)
- Modify: `apps/server/src/app.ts`, `apps/server/test/testApp.ts` (a `cepDispatcher` option like `ptaxDispatcher`)
- Test: `apps/server/src/routes/fiscal.test.ts`, `apps/server/src/routes/issueNewEdges.test.ts`, `apps/server/src/routes/cep.test.ts`

**Interfaces:**
- Produces: `GET emitters/:emitterId/fiscal` → `FiscalConfig & { bands: { III: number[]; V: number[] } }`.
- Produces: `POST invoices/new` accepts `overrides?: { nationalTaxCode?, municipalTaxCode?, nbsCode?, pisCofinsCst?, ibsCbs?: {operationCode,cst,classCode}, export?: {mode,providerLink,providerSupport,customerSupport,temporaryGoods,mdic} }`. Each present field replaces the one of the saved service for this invoice only. The validation is the same as the services schema, and the national code must be in the list (`unknown_service_code`).
- Produces: `GET /api/accounts/:accountId/cep/:cep` (members) → `{ zip, street, district, municipality: { code, name, uf } }`; 400 `invalid_cep` (not 8 digits), 404 `cep_not_found`, 502 `cep_unavailable`.

- [ ] **Step 1: Failing tests.**
  - `fiscal.test.ts`: GET answers `bands.III` = `[600, 1120, 1350, 1600, 2100, 3300]` and `bands.V` = `[1550, 1800, 1950, 2050, 2300, 3050]`, for an emitter with and without a configuration.
  - `issueNewEdges.test.ts`:
    - `overrides: { nationalTaxCode: '010101', nbsCode: '115022000' }` issues with `<cTribNac>010101</cTribNac>` and that NBS. The pending row's `serviceCode` is `010101`. The saved service is unchanged.
    - `overrides: { nationalTaxCode: '999999' }` → 400 `unknown_service_code`, nothing reserved.
  - `cep.test.ts`, with an undici `MockAgent` on `https://viacep.com.br`:
    - `/ws/86010000/json/` answering `{ cep: '86010-000', logradouro: 'Rua Teste', bairro: 'Centro', localidade: 'Londrina', uf: 'PR', ibge: '4113700' }` → 200 `{ zip: '86010000', street: 'Rua Teste', district: 'Centro', municipality: { code: '4113700', name: 'Londrina', uf: 'PR' } }`.
    - `{ erro: 'true' }` → 404 `cep_not_found`.
    - A 500 → 502 `cep_unavailable`.
    - `cep/123` → 400 `invalid_cep`.
    - Another account → 404 (the route sweep covers it once `:cep` has a sweep value: add `cep: '86010000'` to the sweep params).
- [ ] **Step 2:** Run `pnpm vitest run apps/server/src/routes/fiscal.test.ts apps/server/src/routes/issueNewEdges.test.ts apps/server/src/routes/cep.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - Fiscal GET returns `{ ...config, bands: SIMPLES_BANDS }`.
  - `issueNew` merges `input.overrides` onto the service view before `buildTemplate`, checks a changed national code with `serviceCode()`, and stores the merged code in the pending row.
  - `viaCep.ts` exports `fetchCep({ cep, dispatcher? })`: GET `https://viacep.com.br/ws/${cep}/json/` with a 10 s timeout; `erro` means not found; maps `ibge` through `municipality()` from `data/places.ts` (an unknown code is `cep_not_found`).
  - Register `cepRoutes(app, { cepDispatcher })` in `app.ts`.
  - Add `invalid_cep`, `cep_not_found`, `cep_unavailable` to the RFC "Validation and Errors" table and to `ERROR_TEXT`.
- [ ] **Step 4:** Run the server suite, typecheck, and lint → PASS. Commit `feat(server): band table, complete-mode overrides, and the CEP lookup`.

### Task 2: One send flow for both issue screens

**Files:**
- Create: `apps/web/src/components/useIssueSend.ts`, `apps/web/src/components/IssueResultView.tsx`
- Modify: `apps/web/src/pages/IssuePage.tsx` (uses both), `apps/web/src/components/Layout.tsx` (`errorText` shows the detail of `amount_ptax_mismatch`)
- Test: `apps/web/src/pages/IssuePage.test.tsx`, `apps/web/src/components/components.test.tsx`

**Interfaces:**
- Produces:

```ts
// useIssueSend.ts
export interface IssueSend<F> {
  key: string | null; // the idempotency key while reviewing or locked
  locked: boolean; // an unclear answer: only "Tentar de novo" is offered
  busy: boolean;
  error: string | null;
  result: IssueResult | null; // rejected or unknown; issued navigates away
  restored: F | null; // the reviewed form after a reload with a pending send
  startReview(): void; // new key
  backToEdit(): void; // drops the key unless locked
  send(form: F, path: string, body: unknown): Promise<void>;
  verify(invoiceId: string): Promise<void>;
}
export function useIssueSend<F>(options: { accountId: string; storageKey: string }): IssueSend<F>;
export function isDefinitive(error: unknown): boolean;
```

```tsx
// IssueResultView.tsx: the rejected and unknown screens of IssuePage, unchanged in text.
export function IssueResultView(props: {
  accountId: string;
  title: string;
  environment: Environment;
  send: IssueSend<unknown>;
}): JSX.Element;
```

- [ ] **Step 1: Failing tests.**
  - `IssuePage.test.tsx`, "a PTAX failure on send is definitive": the issue POST answers 502 `{ error: 'ptax_unavailable' }`. The review keeps "Voltar e editar", shows the `ptax_unavailable` text, and sessionStorage has no pending send.
  - "a PTAX mismatch shows the expected amount": a 400 `{ error: 'amount_ptax_mismatch', expectedCents: 670321, rate: '5.4321', rateDate: '2026-09-30' }` shows "R$ 6.703,21" and "5,4321 de 30/09/2026".
  - `components.test.tsx`: `isDefinitive` is true for a 4xx and for a 502 `ptax_unavailable`; false for a 502 `http_502`, a 504, a network `TypeError`, a 408, and a 429.
- [ ] **Step 2:** Run `pnpm vitest run apps/web/src/pages/IssuePage.test.tsx apps/web/src/components` → the new tests FAIL; the existing ones pass.
- [ ] **Step 3: Implement.**
  - Move the key, `locked`, `busy`, the sessionStorage pending send (`readPendingSend`, `writePendingSend`, `clearPendingSend`), `confirm`, and `verify` from `IssuePage.tsx` into `useIssueSend`. An issued answer navigates to the invoice, as today.
  - `isDefinitive` adds: a 502 whose code is `ptax_unavailable` is definitive (the server refuses before reserving).
  - `errorText(error)` appends, for `amount_ptax_mismatch`, `Valor esperado: ${formatCents(expectedCents)} (PTAX ${rate with comma} de ${formatDate(rateDate)}).`
  - `IssuePage` keeps its form, PTAX lookup, and review table, and calls the hook. All existing IssuePage tests stay unchanged and green.
- [ ] **Step 4:** Run the web suite, typecheck, and lint → PASS. Commit `refactor(web): one send flow for the issue screens; PTAX refusals are definitive`.

### Task 3: Address form with the IBGE and country lists and the CEP

**Files:**
- Create: `apps/web/src/components/AddressFields.tsx`, `apps/web/src/components/AddressFields.test.tsx`
- Modify: `apps/web/src/api.ts` (types `Municipality`, `Country`, `CepAnswer`), `apps/web/src/pages/CustomerPage.tsx` (uses it; the code text fields go)

**Interfaces:**
- Produces:

```tsx
export interface AddressValue {
  kind: 'domestic' | 'foreign';
  municipality: { code: string; name: string; uf: string } | null; // domestic
  zip: string; // domestic, 8 digits
  country: { code: string; name: string } | null; // foreign
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  complement: string;
  district: string;
}
export function emptyAddress(kind: AddressValue['kind']): AddressValue;
export function addressFromParty(address: PartyAddress | null, kind: AddressValue['kind']): AddressValue;
export function toPartyAddress(value: AddressValue): PartyAddress | null; // null while a required field is empty
export function AddressFields(props: { accountId: string; value: AddressValue; onChange(v: AddressValue): void }): JSX.Element;
```

- [ ] **Step 1: Failing tests** (`AddressFields.test.tsx`, with `stubApi`):
  - Domestic: typing CEP `86010-000` and leaving the field calls `cep/86010000` and fills the street, the district, and the municipality "Londrina - PR". A `cep_not_found` answer shows its text and leaves the fields as they were.
  - The municipality combobox searches `municipalities?q=lond` after 300 ms and selects "Londrina - PR".
  - Foreign: the country combobox searches `countries?q=estados` and selects "Estados Unidos (US)". The CEP field is not shown.
  - `toPartyAddress` returns null without a number, and `{ kind: 'domestic', municipality: '4113700', zip: '86010000', ... }` when complete.
  - `CustomerPage` (existing test file `customers.test.tsx`): editing the address sends `municipality: '4113700'` from the chosen list item, not typed text.
- [ ] **Step 2:** Run `pnpm vitest run apps/web/src/components/AddressFields.test.tsx apps/web/src/pages/customers.test.tsx` → FAIL.
- [ ] **Step 3: Implement** with `Combobox` (debounced 300 ms search), `Field`, and `Input`. The CEP lookup runs on blur when the CEP has 8 digits. It never overwrites a field the user typed after the lookup started.
- [ ] **Step 4:** Web suite, typecheck, lint → PASS. Commit `feat(web): address form with the IBGE and country lists and the CEP lookup`.

### Task 4: Emitter page: fiscal configuration and services

**Files:**
- Modify: `apps/web/src/router.ts` (route `emitter`: `#/a/:accountId/emitters/:emitterId`), `apps/web/src/App.tsx`, `apps/web/src/pages/EmittersPage.tsx` (a "Configuração fiscal e serviços" link on each card)
- Create: `apps/web/src/pages/EmitterPage.tsx`, `apps/web/src/pages/FiscalConfigForm.tsx`, `apps/web/src/pages/ServiceDialog.tsx`, `apps/web/src/pages/EmitterPage.test.tsx`
- Modify: `apps/web/src/api.ts` (types `FiscalConfig`, `Service`, `ServiceCode`)

**Interfaces:**
- Consumes: `GET/PUT emitters/:emitterId/fiscal` (Task 1 bands), `GET/POST emitters/:emitterId/services`, `PUT services/:serviceId`, `GET service-codes?q=`.
- Produces: `routeHref({ name: 'emitter', accountId, emitterId })`.

- [ ] **Step 1: Failing tests** (`EmitterPage.test.tsx`, `router.test.ts`):
  - The router parses `#/a/acc/emitters/em1` as `{ name: 'emitter', accountId: 'acc', emitterId: 'em1' }` and builds it back.
  - Fiscal form, owner:
    - The annex select (III, V) and the band select list "Faixa 1 – 6,00%" … "Faixa 6 – 33,00%" from `bands`.
    - Choosing Annex V switches the band labels to 15,50% … 30,50%.
    - The ISS rate input takes "2,00" and sends `issRate: 200`.
    - The regime select (Dentro do DAS, Regular) has a "desde" date.
    - Save sends PUT and shows "Configuração salva".
  - Fiscal form, member: the fields are shown read-only, and the save button is disabled with "Só o dono da conta altera a configuração fiscal."
  - Services: the list shows name, code (formatted `01.07.01`), and description, and "Arquivados" toggles `?archived=1`.
  - "Novo serviço" opens `ServiceDialog`:
    - The code combobox searches `service-codes?q=suporte` and shows "01.07.01 – Suporte técnico…".
    - The description is prefilled from the code and editable.
    - "Mais opções" shows NBS, PIS/COFINS CST, IBS/CBS (operation code, CST, class), and the export details.
    - Save POSTs and the list refreshes.
  - Edit and archive: edit PUTs with the full input; "Arquivar" PUTs `archived: true`.
  - A member sees the list and every service control disabled.
- [ ] **Step 2:** Run `pnpm vitest run apps/web/src/pages/EmitterPage.test.tsx apps/web/src/router.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The percent text uses `centsInput`-style formatting on hundredths (`600` → `6,00`), with a small helper `percentInput` in `format.ts` and `parsePercent` (the inverse, `null` when invalid), both tested in `format.test.ts`.
- [ ] **Step 4:** Web suite, typecheck, lint → PASS. Commit `feat(web): emitter page with the fiscal configuration and the services`.

### Task 5: New customer

**Files:**
- Create: `apps/web/src/components/NewCustomerForm.tsx`, `apps/web/src/components/NewCustomerForm.test.tsx`
- Modify: `apps/web/src/pages/CustomersPage.tsx` ("Novo cliente" button opening a `Modal` with the form)

**Interfaces:**
- Consumes: `AddressFields` (Task 3), `POST customers`.
- Produces: `NewCustomerForm(props: { accountId: string; emitters: Emitter[]; emitterId?: string; onCreated(customer: Customer): void; onCancel(): void })`.

- [ ] **Step 1: Failing tests:**
  - The form asks first "Cliente no Brasil" or "Cliente no exterior".
  - Brazil: CPF or CNPJ, document, name, e-mail, phone, municipal registration, and the domestic address. It POSTs `{ emitterId, documentType: 'CNPJ', document: '11222333000181', name, address: { kind: 'domestic', municipality: '4113700', zip: '86010000', ... } }`.
  - Abroad: "Tem NIF" checkbox; with it, NIF and the foreign address with country; without it, `documentType: 'NONE'` and no document.
  - Digits typed with dots, slashes, and dashes are sent as digits only.
  - An `invalid_document` answer shows its text next to the document field; `customer_exists` shows its text.
  - With more than one emitter and no `emitterId`, an emitter select is shown.
  - `CustomersPage`: "Novo cliente" opens the dialog, and a created customer appears in the list.
- [ ] **Step 2:** Run `pnpm vitest run apps/web/src/components/NewCustomerForm.test.tsx apps/web/src/pages/customers.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Web suite, typecheck, lint → PASS. Commit `feat(web): register a customer in Brazil or abroad`.

### Task 6: "Nova nota", simplified mode

**Files:**
- Modify: `apps/web/src/router.ts` (route `newInvoice`: `#/a/:accountId/invoices/new`, parsed before an invoice id, with an optional `?customer=<id>` read into `customerId`), `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/NewInvoicePage.tsx`, `apps/web/src/pages/NewInvoicePage.test.tsx`

**Interfaces:**
- Consumes: `useIssueSend` and `IssueResultView` (Task 2), `NewCustomerForm` (Task 5), `GET fiscal` with `bands` (Task 1), `GET services`, `GET customers?emitterId&q`, `GET exchange-rate`, `POST invoices/new`.
- Produces: `routeHref({ name: 'newInvoice', accountId, customerId? })` → `#/a/:accountId/invoices/new` or `…/new?customer=<id>`.

- [ ] **Step 1: Failing tests** (`NewInvoicePage.test.tsx` with `stubApi`; `router.test.ts`):
  - `#/a/acc/invoices/new` parses as `newInvoice`, never as an invoice with id `new`. `#/a/acc/invoices/new?customer=c1` parses with `customerId: 'c1'`, and the page starts with that customer selected.
  - Without a fiscal configuration (`simplesPercent: null`):
    - The owner sees "Configure o Simples e o ISS do emitente antes de emitir" and a link to the emitter page.
    - A member sees "Peça ao dono da conta para configurar…" and no form.
  - Simplified form:
    - With one emitter, the emitter select is not shown.
    - The customer combobox searches `customers?emitterId=em1&q=cli`.
    - "+ Novo cliente" opens `NewCustomerForm` in a dialog, and the created customer becomes the selection.
    - The service select lists the active services, and picking one fills the description.
    - The competence defaults to the end of the previous month (`previousMonthEnd`) and cannot be after today.
    - The Simples band select defaults to the emitter band, labeled with its percent.
  - Brazil customer: the amount is in reais. The ISS line says "ISS no DAS (não retido)". The send body is `{ emitterId, customerId, serviceId, competence, serviceCents, description }` with no foreign fields and no `simplesPercent` when the default band is kept.
  - Customer abroad:
    - The currency select (USD, EUR) and the foreign amount appear.
    - The BRL amount is read-only from `exchange-rate?currency=220&date=<competence>`, and a new competence fetches the rate again.
    - The review is disabled until the rate is loaded.
    - The send body has `foreignCurrency: '220'` and `foreignAmountCents`.
    - No retention option is shown.
  - Another band chosen sends `simplesPercent` with that band's value.
  - Review: a table of Emitente, Cliente, Serviço (code and name), Competência, Descrição, Valor, Faixa do Simples, and ISS. "Emitir nota" (or "Emitir em PRODUÇÃO" for an admin) POSTs `invoices/new` with the `idempotency-key` header.
  - Outcomes, through `useIssueSend`:
    - Issued navigates to the invoice.
    - A Sefin refusal shows the codes and "Voltar e editar".
    - A timeout locks with "Tentar de novo" and the same key.
    - A reload with a pending send restores the reviewed form.
- [ ] **Step 2:** Run `pnpm vitest run apps/web/src/pages/NewInvoicePage.test.tsx apps/web/src/router.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The storage key for the pending send is `notaflow.newInvoice.<accountId>`.
- [ ] **Step 4:** Web suite, typecheck, lint → PASS. Commit `feat(web): Nova nota, simplified mode`.

### Task 7: "Nova nota", complete mode and entry points

**Files:**
- Modify: `apps/web/src/pages/NewInvoicePage.tsx`, `apps/web/src/pages/InvoicesPage.tsx` ("Nova nota" button), `apps/web/src/pages/HomePage.tsx` (a "Nova nota" card next to the account cards), `apps/web/src/pages/CustomerPage.tsx` ("Emitir nota" link)
- Test: `apps/web/src/pages/NewInvoicePage.test.tsx`, `apps/web/src/pages/pages.test.tsx`

- [ ] **Step 1: Failing tests:**
  - "Mais opções" shows:
    - "ISS retido pelo cliente", only for a CNPJ customer in Brazil, with the ISS rate prefilled from the configuration. The minimum (2,00%, or above zero for codes 07.02, 07.05, 16.01) is shown under the field.
    - "Outro percentual do Simples" (percent input).
    - The service code (code search), the municipal code, NBS, PIS/COFINS CST, IBS/CBS, and for an export the export details, all prefilled from the service.
  - The send body:
    - has `issRetained: true` and `issRate`, but only when retained;
    - has `simplesPercent` from the typed percent;
    - has `overrides` with only the fields that differ from the service.
  - The review lists each changed fiscal field under "Alterado nesta nota".
  - `invalid_iss_rate` with `minimum: '2.00'` shows "A alíquota mínima deste serviço é 2,00%."
  - `InvoicesPage` has "Nova nota" linking to `#/a/acc/invoices/new`. `HomePage` shows a "Nova nota" card per account. `CustomerPage` links to "Nova nota" with the customer (`routeHref({ name: 'newInvoice', accountId, customerId })`).
- [ ] **Step 2:** Run the tests → FAIL. **Step 3:** Implement. **Step 4:** Web suite, typecheck, lint → PASS. Commit `feat(web): Nova nota, complete mode, and its entry points`.

### Task 8: Docs, browser acceptance, final check

- [ ] Update `docs/ENGINEERING/ARCHITECTURE/WEB_UI.md` (the new screens and the shared send flow), `apps/web/AGENTS.md` (the new pages), and the RFC (status; the place-of-service decision under "Decisions").
- [ ] **Browser acceptance** on the local server with `pnpm fake:nacional` and `pnpm dev:server` + `pnpm dev:web`, driven with Playwright. Steps:
  1. Configure an emitter as owner. Annex III band 2 shows 11,20%.
  2. Create a service from the code search.
  3. Create a customer in Brazil by CEP and one abroad without a NIF.
  4. Issue a Brazil invoice in simplified mode.
  5. Issue an export invoice in USD, checking that the BRL amount follows the competence.
  6. Issue a retained-ISS invoice in complete mode.
  7. Force a timeout on the fake (`fake.next`) and check "Tentar de novo" with the same key.
  8. As a member, check the disabled controls.

  Take screenshots in light and dark mode at phone width and at desktop width, and check that nothing scrolls sideways.
- [ ] Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pytest services/signer-py` → PASS. `pnpm malphas:check` may fail until the Malphas round; record it.
- [ ] Commit `docs: Stage 2b screens`.
