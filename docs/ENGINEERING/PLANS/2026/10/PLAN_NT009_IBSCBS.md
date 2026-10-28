# NT 009: the IBS/CBS Group on Domestic Invoices (Issue #84)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under the NT 009 layout, every domestic DPS carries the `IBSCBS` group, so rule E0855 does not refuse domestic invoices when production switches to NT 009.

**Architecture:** `buildTemplate` already writes `ibsCbs` for an export. It now writes it for a domestic invoice too, from the service's own codes or, when the service has none, from defaults per LC 116 item taken from the Anexo VIII. `buildDpsXml` writes the group for a domestic invoice only under the `nt009` layout, so production keeps its NT 004 output until `NT009_FROM`. The service form already has the IBS/CBS fields in "Mais opções"; they become available for domestic services, prefilled with the defaults.

**Tech Stack:** TypeScript, Vitest, the vendored XSDs (`schemas/nt009`), Python with `openpyxl` only to convert the Anexo VIII once.

**Spec:** [Issue #84](https://github.com/Vapulab/notaflow/issues/84) and its comment of 2026-10-23; [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md).

## Global Constraints

- Source of the defaults: Anexo VIII v1.02.00 of 2026-10-26, <https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexo_viii-tabela-correlacao-v01-02-00-20261026.xlsx>, sheet "tabela geral". Per LC 116 item: column INDOP gives `cIndOp`; the first cClassTrib row of the item gives `cClassTrib`; `CST` is the first 3 digits of `cClassTrib`.
- Fallback when an item has no INDOP or cClassTrib: `cIndOp 100301`, `CST 000`, `cClassTrib 000001` (checked in produção restrita on 2026-10-21).
- `indFinal`: `1` when the customer document is a CPF, `0` otherwise (decided by Lincoln on 2026-10-28). No customer: `0`.
- `indDest`: `0`. `finNFSe` (purpose): `0`.
- The service's own `ibsCbs` (set in "Mais opções") wins over the default.
- The NT 004 layout output does not change for a domestic invoice: no `IBSCBS` group under `nt004`. Exports keep their current output in both layouts.
- `NT009_FROM` in `packages/provider-nacional/src/dps/layout.ts` stays the one place for the switch date.
- Every XML builder change has a test that validates against the vendored XSD of each layout.
- Project rules: no `!`; one-line comments, only the non-obvious why; amounts in integer cents; no AI attribution; never `--no-verify`; docs in Simplified Technical English, no em dash.

## Review Focus

1. **A CPF customer** gets `indFinal 1`; a CNPJ or a foreign customer gets `0`. Test in Task 2.
2. **A service with a CST of no IBS/CBS due (400, 410, 820)** writes no `cIndOp` and no `gIBSCBS` (the existing NT 009 rule). Test in Task 2.
3. **An invoice issued in production before 2026-12-01** has exactly today's XML. Test in Task 2.
4. **"Emitir parecida" of an NT 009 domestic invoice** reads the group back and issues it again unchanged. Test in Task 2.
5. **An LC 116 item missing from the table** uses the fallback. Test in Task 1.

---

### Task 1: The Anexo VIII defaults

**Files:**
- Create: `packages/provider-nacional/src/rules/ibsCbsDefaults.ts`, `packages/provider-nacional/src/rules/anexo8.json`, `packages/provider-nacional/src/rules/ibsCbsDefaults.test.ts`, `packages/provider-nacional/scripts/anexo8.py` (the one-time converter), `packages/provider-nacional/schemas/SOURCE.md` (add the Anexo VIII line)
- Modify: `packages/provider-nacional/src/index.ts` (export `ibsCbsDefaults`)

**Interfaces:**
- Produces: `ibsCbsDefaults(nationalTaxCode: string): { operationCode: string; cst: string; classCode: string }` — the key is the first 4 digits of `cTribNac` (LC 116 item `01.01` is `0101`).

- [ ] **Step 1:** Write `scripts/anexo8.py` (reads the xlsx path from argv, forward-fills the item column, writes `{ "0101": { "operationCode": "100301", "classCode": "000001" }, ... }` sorted by key). Run it once and commit the JSON. The script is a record of how the JSON was made; it is not run in CI.
- [ ] **Step 2: Failing tests:** `0101` (Análise e desenvolvimento de sistemas) gives `100301 / 000 / 000001`; an item whose INDOP is a place-of-service code gives that code (pick one from the JSON); an unknown item `9999` gives the fallback; every JSON entry has a 6-digit `operationCode` and a 6-digit `classCode`.
- [ ] **Step 3: Implement** `ibsCbsDefaults`. `cst` is `classCode.slice(0, 3)`.
- [ ] **Step 4: Run** `pnpm vitest run packages/provider-nacional` → PASS.
- [ ] **Step 5: Commit** `feat(provider-nacional): add IBS/CBS defaults per LC 116 item from the Anexo VIII`

---

### Task 2: Domestic invoices carry the IBS/CBS group under NT 009

**Files:**
- Modify: `packages/provider-nacional/src/template/buildTemplate.ts` (around the `abroad && service.ibsCbs` branch), `packages/provider-nacional/src/dps/buildDpsXml.ts` (`ibsCbs()`), their tests, and `readTemplate` tests

**Interfaces:**
- Consumes: `ibsCbsDefaults` (Task 1).

- [ ] **Step 1: Failing tests:**
  - `buildTemplate` of a domestic invoice with no service codes gives `ibsCbs { purpose '0', finalConsumer '0', operationCode '100301', destination '0', cst '000', classCode '000001' }` for item 0101; with a CPF customer `finalConsumer '1'`; with service codes, those codes.
  - `buildDpsXml` with layout `nt009` (produção restrita, issuedAt 2026-10-28) writes `<IBSCBS><indFinal>0</indFinal><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS/></trib></valores></IBSCBS>` and validates against `schemas/nt009`.
  - The same input with production and issuedAt 2026-11-30 (`nt004`) writes no `IBSCBS` and is byte-identical to the output before this change (keep a fixture of the current output).
  - CST 410 under `nt009`: no `cIndOp`, no `gIBSCBS`.
  - An export keeps its current output under both layouts.
  - `readTemplate` of an NT 009 domestic DPS returns the same `ibsCbs`, and `applyTemplate` issues it again unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `buildTemplate` sets `ibsCbs` for every invoice (export as today; domestic from the service codes or `ibsCbsDefaults(nationalTaxCode)`). `buildDpsXml` skips the group when the layout is `nt004` and the invoice is domestic.
- [ ] **Step 4: Run** `pnpm vitest run packages/provider-nacional apps/server` → PASS (server issue tests may need the new group in expected XML under NT 009 dates).
- [ ] **Step 5: Commit** `feat(provider-nacional): write the IBS/CBS group on domestic invoices under NT 009`

---

### Task 3: The service form offers the IBS/CBS codes for domestic services

**Files:**
- Modify: `apps/web/src/pages/completeMode.ts`, the service form in "Mais opções" (find where the IBS/CBS fields render and why they are export-only), `apps/server/src/routes/serviceSchema.ts` (validation), an endpoint or shared helper so the form can show the default codes for the chosen `cTribNac` (the server can return them with the service suggestions, or the web imports `ibsCbsDefaults` from `@notaflow/provider-nacional/simples`-style browser entry if the JSON is small enough; pick the smaller change and say why)
- Test: the matching web and server tests

- [ ] **Step 1: Failing tests:** for a domestic service, "Mais opções" shows `cIndOp`, `CST`, `cClassTrib` prefilled with the defaults of the chosen item; saving an override stores it; leaving the defaults stores nothing (the defaults stay dynamic); the server refuses a code that is not 6 digits (cIndOp, cClassTrib) or 3 digits (CST).
- [ ] **Step 2–4:** fail, implement, pass (`pnpm vitest run apps/web apps/server`).
- [ ] **Step 5: Commit** `feat(web): offer the IBS/CBS codes for domestic services`

---

### Task 4: Check in produção restrita and close the docs

- [ ] **Step 1 (controller, not a subagent):** run `pnpm spike:new-invoice` in produção restrita for a domestic invoice to a CNPJ and one to a CPF with the code of this branch; both must be accepted and then cancelled. Record the Sefin answers.
- [ ] **Step 2:** Update `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md` (one paragraph: the group, the defaults, the source) and `packages/provider-nacional/AGENTS.md` (`ibsCbsDefaults`).
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 4: Commit** `docs: record the IBS/CBS group on domestic invoices`
