# Stage 3c: Guided Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company signs up alone: it names its account, sends its CNPJ card and its A1 certificate, optionally sets the fiscal configuration, sees its invoices sync, and gets a tour of the app. Signup then opens to everyone.

**Architecture:**

- `accounts.onboarding_step` stores where an account is. `/app` sends an account that is not `done` to `/app/comecar`, a timeline built from Malphas components.
- The CNPJ card is a text PDF. The server reads it in a worker thread with a timeout, finds the CNPJ, and stores the gzipped card as an account document. A public lookup (BrasilAPI, with CNPJá open as the fallback) gives the legal name, the IBGE municipality, the registration status, and the Simples and MEI options.
- The certificate step reuses the emitter creation of today (validity, Sefin connection test, vault), moved into a service that also checks that the certificate's CNPJ equals the card's.
- driver.js shows the tour on the first visit to the dashboard; `users.tour_seen_at` stores it.

**Tech Stack:** Fastify 5, Drizzle 0.45, SQLite, `unpdf@1.8.1` (pdf.js text extraction), `pdf-lib@1.17.1` (tests only: synthetic cards), `driver.js@1.8.0`, React 19, Vitest, Playwright for the browser sweep.

**Spec:** [RFC_SAAS_SIGNUP](../../RFCS/2026/10/RFC_SAAS_SIGNUP.md), sections "Stage 3c: Guided Onboarding", "Security", and "Testing and Acceptance".

## Spike results (2026-10-11, public CNPJ of Petrobras, nothing committed)

- **BrasilAPI** `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` answers 200 with:
  - `razao_social`, `nome_fantasia`;
  - `descricao_situacao_cadastral` (`ATIVA`) and `situacao_cadastral` (2);
  - `codigo_municipio_ibge` (7 digits), `municipio`, `uf`, and the address;
  - `cnae_fiscal`;
  - `opcao_pelo_simples` and `opcao_pelo_mei` (`true`, `false`, or `null`).

  An invalid CNPJ answers 400. The answer carries no rate-limit headers.
- **CNPJá open** `GET https://open.cnpja.com/office/{cnpj}` answers 200 with:
  - `status.text` (`Ativa`) and `status.id` (2);
  - `company.simples.optant` and `company.simei.optant`;
  - `address.municipality` (IBGE), `company.name`, and `alias`.

  Its free tier allows a few requests per minute: the fallback only.

## Decisions (confirmed by Lincoln on 2026-10-11)

1. **What the card proves.** The parser needs only the CNPJ (a fixed pattern) and checks the legal name against the lookup. The lookup gives everything else. A change in the card layout then breaks only the name check, and the step still works.
2. **A real card, read locally once** (Task 3, Step 1), at a path Lincoln gave, outside the repo. A script prints only which labels it found, never values, and the card stays out of git.
3. **The default DPS series stays `900`**, as the current form. It is under "Opções avançadas".
4. **Only an account that already has an emitter skips onboarding.** In production that is Vapulab, Lincoln's account; the other two current accounts have no emitter and start at the card step. An account made by a platform admin also starts at the card step.
5. **Signup opens at the end**: `SIGNUP_OPEN=true` in production after the acceptance of Task 10, with Lincoln's go-ahead.

## Global Constraints

- **Steps, in order:** `company`, `card`, `certificate`, `fiscal`, `sync`, `done`. `accounts.onboarding_step` is text, not null, default `card`. The migration sets `done` on every account with an active emitter. A new account from signup or from the admin panel starts at `card` (its name is already known).
- **Card upload:** PDF only (`%PDF-` magic), at most 2 MB decoded. It is parsed in a `worker_threads` worker with a 5-second timeout and `isEvalSupported: false`. The route `bodyLimit` is 3 MB.
- **The card is stored** in `account_documents` (a business table: soft delete, stamps, a `no_delete` trigger, and `notDeleted` on reads), gzipped, with its SHA-256 and size.
- **Lookup:** a timeout of 8 seconds per source; BrasilAPI first, CNPJá open on a 5xx, a timeout, or a 429. Both down gives 502 `cnpj_lookup_unavailable`, and the step offers "Tentar de novo". It never guesses the Simples option.
- **Status:** a status other than `ATIVA`/`Ativa` stops the card step with 422 `cnpj_not_active`, naming the status.
- **Simples mapping** (`opSimpNac`): MEI optant gives `2`; Simples optant and not MEI gives `3`; anything else gives `1`. `simplesRegime` defaults to `1`, `specialRegime` to `0`, and `dpsSeries` to `900`.
- **Ownership:** the certificate's CNPJ must equal the card's CNPJ (409 `certificate_cnpj_mismatch`). The emitter rules stay: one account per CNPJ, and a removed emitter's CNPJ is blocked.
- **Environment:** onboarding always creates the emitter in production.
- **Invited users** join an existing account and never see onboarding.
- **Project rules:** no TypeScript non-null assertions; never delete a business row; no real card, CNPJ, or certificate in git (tests use `@notaflow/test-kit` certificates, synthetic PDFs, and CNPJ `12345678000195`); English text follows the Writing Style with no em dash; no AI attribution; scripts run on Windows and Linux.

## Review Focus

1. **A malicious or broken PDF.** Expected: a PDF that is not text, is encrypted, is over 2 MB, or makes the parser loop answers 422 `card_unreadable` or 413, within 5 seconds, and the server keeps serving. Pinned in Task 3.
2. **Someone else's company.** Expected: a card of CNPJ A and a certificate of CNPJ B is refused with 409 `certificate_cnpj_mismatch`, and nothing is stored. A CNPJ that is already an emitter in another account is refused at the card step, not only at the certificate step. Pinned in Tasks 3 and 4.
3. **A user who leaves and comes back.** Expected: a reload, or a login on another device, opens the current step. A finished step cannot run again out of order. Pinned in Tasks 2 and 6.
4. **Lookup outage.** Expected: BrasilAPI down falls back to CNPJá; both down gives a retry message. The Simples option is never set without a lookup answer. Pinned in Task 3.
5. **Two people of one account doing onboarding at the same time.** Expected: the second certificate for the same CNPJ gets `emitter_exists`, and the step moves forward once. Pinned in Task 4.

---

### Task 1: Onboarding state and account documents

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/db/businessTables.ts`
- Create: `apps/server/drizzle/0010_onboarding.sql` (generated, then edited) and its snapshot
- Test: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces in `schema.ts`:
  - `accounts.onboardingStep`: text enum `['company','card','certificate','fiscal','sync','done']`, not null, default `'card'`;
  - `accounts.cnpjDraft`: text JSON, null; the confirmed card data between the card and certificate steps;
  - `users.tourSeenAt`: timestamp, null;
  - `accountDocuments` (`account_documents`): `id`, `account_id` (fk), `kind` (`'cnpj_card'`), `cnpj`, `file_name`, `content_gzip` (blob), `sha256`, `size_bytes`, plus the six control columns.
- `BUSINESS_TABLES` gains `account_documents`.

- [ ] **Step 1: Failing tests.**
  - On a database migrated to `0009` with three accounts, one with an active emitter, one with a removed emitter, and one without: after `0010` the first reads `done` and the other two read `card`.
  - `account_documents` has its `account_documents_no_delete` trigger, and the catalog test lists it as a business table.
  - `users_no_delete` and `accounts_no_delete` still exist (the migration must not rebuild those tables).
- [ ] **Step 2:** `pnpm vitest run apps/server/src/db` → FAIL.
- [ ] **Step 3:** Implement. Run `pnpm --filter @notaflow/server exec drizzle-kit generate --name onboarding`. Check the SQL: `ALTER TABLE ... ADD` only. Append the trigger `CREATE TRIGGER account_documents_no_delete ... RAISE(ABORT, 'soft delete only')`.
- [ ] **Step 4:** PASS, typecheck, lint. Commit `feat(server): onboarding state and account documents`.

### Task 2: Account creation and the onboarding API

**Files:**
- Create: `apps/server/src/routes/onboarding.ts`, `apps/server/src/repos/OnboardingRepository.ts`, `apps/server/src/routes/onboarding.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/routes/me.ts`, `apps/server/src/routes/routeSweep.test.ts`

**Interfaces:**
- `POST /api/onboarding/account` `{ name }`: for a user with no active membership only (else 409 `already_member`). It creates the account at step `card` with the user as owner, in one transaction, audited `account.create`. It returns `{ accountId }`.
- `GET /api/accounts/:accountId/onboarding` (member): `{ step, draft: CnpjDraft | null }`.
- `POST /api/accounts/:accountId/onboarding/fiscal-done` (owner): `fiscal` → `sync`, after the fiscal configuration is saved through its existing route or skipped with "Fazer depois".
- `POST /api/accounts/:accountId/onboarding/finish` (owner): `sync` → `done`.
- `/api/me` accounts gain `onboardingStep`.
- `OnboardingRepository.advance(ctx, from, to): boolean` updates only when the current step equals `from` (a compare-and-set), so a step never runs twice or out of order.

- [ ] **Step 1: Failing tests:**
  - a new user creates an account and becomes its owner at `card`;
  - a second call answers 409 `already_member`;
  - a member that is not the owner gets 403 on `fiscal-done` and `finish`;
  - `advance` from the wrong step changes nothing and answers 409 `onboarding_step` with the current step (**Review Focus 3**);
  - `/api/me` shows the step;
  - the route sweep covers the new routes (401 without a session, 404 for a stranger).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** server suite, typecheck, lint → PASS. Commit `feat(server): account creation and onboarding steps`.

### Task 3: The CNPJ card: reading, lookup, and check

**Files:**
- Create: `apps/server/src/onboarding/cardReader.ts`, `apps/server/src/onboarding/cardWorker.ts`, `apps/server/src/onboarding/cnpjLookup.ts`, and their tests; `apps/server/test/syntheticCard.ts` (pdf-lib)
- Modify: `apps/server/src/routes/onboarding.ts`, `apps/server/package.json` (`unpdf@1.8.1`; dev `pdf-lib@1.17.1`)

**Interfaces:**

```ts
export interface CardText { cnpj: string; legalName: string | null }
export function readCard(pdf: Buffer, options?: { timeoutMs?: number }): Promise<CardText>; // throws CardError('card_unreadable' | 'card_no_cnpj')

export interface CnpjDraft {
  cnpj: string; legalName: string; tradeName: string | null;
  municipality: string; uf: string; cnae: string | null;
  simplesNacional: '1' | '2' | '3'; source: 'brasilapi' | 'cnpja';
}
export function lookupCnpj(cnpj: string, deps?: { dispatcher?: Dispatcher }): Promise<CnpjDraft>; // throws LookupError('cnpj_not_found' | 'cnpj_not_active' | 'cnpj_lookup_unavailable')
```

- `POST /api/accounts/:accountId/onboarding/card` (owner), `{ pdfBase64, fileName }`, at step `card`:
  1. Read the card.
  2. Refuse a CNPJ that already has an emitter in this account or another one, or that belongs to a removed emitter (the same codes as today).
  3. Look up the CNPJ.
  4. Check the legal name; a different name only adds `nameMismatch: true` to the answer.
  5. Store the document and the draft.
  6. Advance to `certificate`.

  It answers the draft plus `nameMismatch`.
- `POST /api/accounts/:accountId/onboarding/cnpj` (owner), `{ cnpj }`: the fallback for a card that cannot be read. Same checks and lookup; no document stored.

- [ ] **Step 1: Real card check (Lincoln).** `pnpm tsx apps/server/scripts/cardLabels.ts <path>` reads a real card locally and prints which labels it found (`CNPJ`, `NOME EMPRESARIAL`, `SITUAÇÃO CADASTRAL`) and whether a CNPJ pattern matched. It prints no value. The script is committed; the card is not. Adjust the label list from what it shows.
- [ ] **Step 2: Failing tests:**
  - **Reading:** a synthetic card (pdf-lib, the label layout from Step 1, CNPJ `12.345.678/0001-95`) gives `12345678000195` and its name. **Review Focus 1:** a scanned-style PDF without text gives `card_unreadable`; a non-PDF gives `card_unreadable`; over 2 MB gives 413; a worker that does not answer in 5 s is ended and gives `card_unreadable`.
  - **Lookup** (MockAgent): BrasilAPI `ATIVA` with Simples true and MEI false gives `3`; with MEI true gives `2`; with null gives `1`. A BrasilAPI 503, timeout, or 429 falls back to CNPJá with the same mapping. Both down gives `cnpj_lookup_unavailable`. `BAIXADA` gives `cnpj_not_active` with the status. A 400 or 404 gives `cnpj_not_found`. **Review Focus 4.**
  - **Route:** at the wrong step it answers 409 `onboarding_step`. A CNPJ in another account gives 409 `cnpj_in_other_account` (**Review Focus 2**). Success stores one gzipped document with its SHA-256, and the step becomes `certificate`.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS, server suite. Commit `feat(server): the CNPJ card step, with the public lookup`.

### Task 4: The certificate step

**Files:**
- Create: `apps/server/src/emitters/EmitterOnboarding.ts` (moved from `routes/emitters.ts`, no behavior change), `apps/server/src/emitters/EmitterOnboarding.test.ts`
- Modify: `apps/server/src/routes/emitters.ts` (uses the service), `apps/server/src/routes/onboarding.ts`

**Interfaces:**
- `EmitterOnboarding.create(ctx, input: { pfxBase64; password; municipality; municipalRegistration?; simplesNacional; simplesRegime?; specialRegime; dpsSeries; expectedCnpj?: string }): Promise<{ id; cnpj; companyName; environment }>`. It does what the route did, plus refuses a certificate whose CNPJ differs from `expectedCnpj` (409 `certificate_cnpj_mismatch`).
- `POST /api/accounts/:accountId/onboarding/certificate` (owner), `{ pfxBase64, password, municipalRegistration?, advanced?: { simplesRegime?, specialRegime?, dpsSeries? } }`, at step `certificate`. It takes the municipality, the Simples option, and the expected CNPJ from the draft. It advances to `fiscal`, which starts the first sync as today.

- [ ] **Step 1 (move):** move the creation code into `EmitterOnboarding`, change nothing else, and run `pnpm vitest run apps/server/src/routes/emitters.test.ts` → PASS. Commit `refactor(server): emitter creation as a service`.
- [ ] **Step 2: Failing tests:**
  - **Review Focus 2:** a card of `12345678000195` with a test-kit certificate of another CNPJ gives 409 `certificate_cnpj_mismatch`; no emitter, certificate, or step change.
  - The matching certificate creates the emitter with the draft's municipality and Simples option, `simplesRegime` `1`, `specialRegime` `0`, series `900`, in production; the step becomes `fiscal`.
  - **Review Focus 5:** two parallel posts give one 201 and one 409 `emitter_exists`.
  - A wrong password gives `WRONG_PASSWORD` and keeps the step.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS. Commit `feat(server): the certificate step proves the CNPJ`.

### Task 5: The timeline screen

**Files:**
- Create: `apps/web/src/pages/onboarding/OnboardingPage.tsx`, `Timeline.tsx`, `CompanyStep.tsx`, `CardStep.tsx`, `CertificateStep.tsx`, `FiscalStep.tsx`, `SyncStep.tsx`, and `onboarding.test.tsx`
- Modify: `apps/web/src/router.ts` (`{ name: 'onboarding'; accountId?: string }` at `/app/comecar` and `/app/comecar/:accountId`), `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/components/Layout.tsx` (error texts)

- [ ] **Step 1: Failing tests:**
  - **Timeline:** the 7 steps (Criar conta, Nome da empresa, Cartão CNPJ, Certificado digital, Configuração fiscal, Sincronização, Tour), each with a title, one line, and a state (feito, atual, a fazer). Vertical on desktop, stacked at 390 px.
  - **Company:** a name creates the account and moves to the card.
  - **Card:**
    - a PDF upload (accept `application/pdf`) shows "Confira os dados": legal name, CNPJ, municipality and UF, Simples, and a municipal registration field;
    - `card_unreadable` offers "Digitar o CNPJ";
    - `cnpj_not_active` shows the status;
    - `cnpj_lookup_unavailable` shows "Tentar de novo".
  - **Certificate:** the .pfx, its password (`autocomplete="off"`), and "Opções avançadas" (Simples regime, special regime, DPS series) folded; `certificate_cnpj_mismatch` has its text.
  - **Fiscal:** the existing `FiscalConfigForm`; saving it or "Fazer depois" posts `fiscal-done`.
  - **Sync:** a counter of imported invoices (polls `GET /api/accounts/:id/invoices?limit=1` total every 3 s), and "Ir para o painel", available at once.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** web suite, typecheck, lint, build → PASS. Commit `feat(web): the onboarding timeline`.

### Task 6: Routing into onboarding

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/MeContext.tsx`, `apps/web/src/pages/EmittersPage.tsx`
- Test: `apps/web/src/pages/onboarding.test.tsx`, `apps/web/src/pages/HomePage.test.tsx`

- [ ] **Step 1: Failing tests:**
  - a user with no account at `/app` goes to `/app/comecar`;
  - a user whose only account is not `done` goes to `/app/comecar/<id>`, at its current step (**Review Focus 3**);
  - a user with a `done` account and one not done sees the home with "Continuar cadastro" on the second;
  - an invited member of a `done` account never sees onboarding;
  - the Emitentes page has "Adicionar emitente", which runs the card, certificate, fiscal, and sync steps for a second emitter, without the timeline's account steps.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. For the second emitter, `POST /api/accounts/:accountId/emitters/new/card` and `.../emitters/new/cnpj` run the same checks and store the draft in `accounts.cnpj_draft` without touching `onboarding_step`; `POST .../emitters/new/certificate` reads that draft, calls `EmitterOnboarding.create` with its CNPJ, and clears it. Server tests in `onboarding.test.ts`: a `done` account adds a second emitter, its step stays `done`, and a certificate without a draft answers 409 `card_required`. **Step 4:** PASS. Commit `feat: onboarding entry, and a second emitter through the same steps`.

### Task 7: The tour

**Files:**
- Modify: `apps/web/package.json` (`driver.js@1.8.0`), `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/Layout.tsx` (user menu: "Ver o tour de novo"), `apps/server/src/routes/me.ts` (`POST /api/me/tour-seen`, and `tourSeenAt` in `/api/me`)
- Create: `apps/web/src/tour/tour.ts`, `apps/web/src/tour/tour.test.ts`

- [ ] **Step 1: Failing tests:**
  - On the first dashboard visit with `tourSeenAt: null`, the tour starts and highlights Nova nota, Notas, Emitir parecida, Clientes, and Emitentes, plus the fiscal configuration when the account skipped it.
  - Closing or finishing it posts `tour-seen` once.
  - "Ver o tour de novo" starts it again.
  - The tour texts are in Portuguese, and the buttons are "Próximo", "Voltar", and "Concluir".
  - Its colors come from the Malphas tokens.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat(web): the first-visit tour`.

### Task 8: Docs

- [ ] `docs/ENGINEERING/ARCHITECTURE/ONBOARDING.md` (new): the steps, the card reader worker, the lookup sources and fallback, the ownership check, and the second-emitter path.
- [ ] `docs/ENGINEERING/CONVENTIONS/DATA.md`: `account_documents`.
- [ ] `WEB_UI.md` screens table: `/app/comecar`.
- [ ] `apps/server/AGENTS.md`: the onboarding entry points.
- [ ] RFC: status, and close the open questions on BrasilAPI, the card layout, and the default DPS series.
- [ ] Commit `docs: guided onboarding`.

### Task 9: Local browser sweep

Run the dev server with signup open, the console mailer, the Turnstile test keys, and `pnpm fake:nacional`. Use a synthetic card with the test-kit CNPJ and the matching test-kit certificate.

- [ ] Signup by code, then each step to the dashboard. Leave at the card step, log in again, and land at the card step.
- [ ] A card of another CNPJ than the certificate is refused.
- [ ] The tour runs once, and again from the menu.
- [ ] A second emitter from Emitentes.
- [ ] 390 px and desktop, light and dark; no horizontal scroll; zero unexpected console errors.
- [ ] Then: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pytest services/signer-py`, and the image built from `git archive HEAD` starts.

### Task 10: Production (each step after Lincoln's go-ahead)

1. Back up the database.
2. Merge the PR (deploy); check the container, the logs, the migration count (11), that Vapulab is `done`, and that the two accounts without an emitter are at `card`.
3. Lincoln creates a test account with another e-mail and goes through onboarding with a real company of his. A CNPJ that is already an emitter is refused, as designed, so he uses one that is not, or stops at the card step.
4. Set `SIGNUP_OPEN=true` in `/opt/notaflow/.env` and restart the app. Signup is open.
5. Publish the Google consent screen when the legal pages of stage 3d exist.
