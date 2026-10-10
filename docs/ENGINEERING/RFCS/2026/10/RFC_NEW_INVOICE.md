# RFC: New Invoices Without a Template, Customers, and Services

**Status:** Accepted (Stage 2a server and Stage 2b screens implemented)
**Date:** 2026-10-10
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [RFC: NotaFlow NFS-e Emitter](RFC_NFSE_EMITTER.md) (the platform this extends)
- [Invoice Lifecycle](../../../ARCHITECTURE/INVOICE_LIFECYCLE.md) (issue, idempotency, E0014, reconcile, cancel)
- [NT SE/CGNFS-e 004 v2.00, IBS/CBS layout](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc-producao-restrita-piloto/nt-004-se-cgnfse-novo-layout-rtc-v2-00-20251210.pdf)
- NT 009/2026 (IBS/CBS for the Simples Nacional, `vReceitaBrutaSN`, regime of apportionment); its rollout schedule is not published yet

## Table of Contents

1. [Overview](#overview)
2. [Goals and Non-Goals](#goals-and-non-goals)
3. [Decisions](#decisions)
4. [Design](#design)
5. [Tax Reform (IBS/CBS)](#tax-reform-ibscbs)
6. [Data Model](#data-model)
7. [API](#api)
8. [Screens](#screens)
9. [Validation and Errors](#validation-and-errors)
10. [Testing and Acceptance](#testing-and-acceptance)
11. [Open Questions](#open-questions)

---

## Overview

Today NotaFlow issues a new NFS-e only by copying a stored one ("issue similar"): every fiscal group comes from the template XML. A new customer of the platform, or a known customer with a new kind of service, cannot be invoiced without a previous invoice to copy.

This RFC adds:

- **Customers created from scratch**, in Brazil or abroad.
- **Services** per emitter: the service code, NBS, default description, and fiscal defaults, so a user never types a tax code.
- **A fiscal configuration per emitter**: the Simples Nacional annex and band, the default ISS rate, and the IBS/CBS regime.
- **"Nova nota"**: issue an invoice without a template, in a **simplified mode** (customer, service, competence, amount, rates) and a **complete mode** (every fiscal field), for a customer in Brazil (amount in reais) or abroad (amount in a foreign currency, with the PTAX already built).

Every emitter of the platform is a Simples Nacional optant (Lincoln, 2026-10-10).

## Goals and Non-Goals

**Goals**

- A platform customer issues their first invoice with no earlier invoice, without knowing tax codes by heart.
- Customers in Brazil and abroad are both covered; the customer's country decides the tax treatment.
- The rates come prefilled and can be changed per invoice: the Simples band and the ISS rate.
- The 2026 rules of the tax reform are fully met, and the design takes the 2027 rules as a new rule version, not a rewrite.

**Non-goals (this RFC)**

- The 2027 IBS/CBS highlight (values, gross revenue `vReceitaBrutaSN`, the regular regime). It is its own stage, due before 2027-01-01, once NT 009 has a published schedule and a test environment (see [Tax Reform](#tax-reform-ibscbs)).
- Non-Simples emitters (Lucro Presumido or Real).
- Retained ISS calculations beyond the flag, deductions, and discounts.
- Changing "issue similar": it stays as it is.

## Decisions

From the design session with Lincoln on 2026-10-10:

| Topic | Decision |
| --- | --- |
| Prefilled rates | Both the Simples total percent (`pTotTribSN`, by annex band) and the municipal ISS rate (`pAliq`). |
| Where defaults come from | The emitter's fiscal configuration, set once by the owner; the user can pick another band per invoice. |
| Choosing the service | Saved services per emitter in the simplified mode, and a search on the national service code table to register a service and in the complete mode. |
| Modes | Simplified: customer, service, competence, description, amount, Simples band, ISS. Complete ("Mais opções"): service codes, place of service, ISS treatment and retention, PIS/COFINS, IBS/CBS, export details. |
| Customers | Brazil (CNPJ or CPF) and abroad (NIF or no NIF); the customer decides the tax treatment. |
| Building the invoice | Approach 1: a **synthetic template**. The new invoice is built into the same `DpsTemplate` that "issue similar" reads from an XML, and goes through the existing issue path unchanged. |
| Tax reform | A separate section; 2026 rules now, the 2027 highlight as its own stage due by December 2026. |
| Place of service (Stage 2b review) | Always the emitter's municipality. An export done in Brazil keeps it there, with the customer's country in `cPaisResult`. A service done in person in another municipality, or abroad (`cPaisPrestacao`), is a later stage. |
| Export support mechanisms (Stage 2b review) | A service without export details declares `mecAFComexP` and `mecAFComexT` 01 (Nenhum). The earlier invoices carried 02 (ACC for the provider, public administration for the customer), which does not fit a private customer abroad. Checked in produção restrita on 2026-10-10. |

## Design

### The synthetic template

"Issue similar" works in two steps: `readTemplate(xml) → DpsTemplate`, then `applyTemplate(template, request) → DpsInput → signed DPS`. Everything after the template (DPS number reservation, the pending row, the send, E0014 and the ownership check, reconcile, idempotency, cancel) is shared and already in production.

The new invoice adds a second producer of the same `DpsTemplate`:

```
buildTemplate({ emitter, fiscalConfig, service, customer, options, competence }) → DpsTemplate
```

`buildTemplate` lives in `packages/provider-nacional/src/template/buildTemplate.ts`, next to `readTemplate`, so the two stay inverse-compatible: every field `buildTemplate` writes is a field `readTemplate` reads and `buildDpsXml` writes.

### Tax rules by competence

The decisions that depend on the law live in one module, `taxRules(competence)`, which returns the rule set in force for that competence date:

- `rules2026`: the current rules (below).
- `rules2027`: added by the 2027 stage.

`buildTemplate` asks the rule set what to write; no tax rule is spread across screens or routes.

**Rules 2026, Simples Nacional ME/EPP (`opSimpNac` 3):**

| Customer | ISS (`tribMun`) | Federal | IBS/CBS group | Foreign trade |
| --- | --- | --- | --- | --- |
| Brazil | `tribISSQN` 1 (taxable). Not retained (`tpRetISSQN` 1, the default): **no `pAliq`**, the ISS is paid in the DAS. Retained by the customer (`tpRetISSQN` 2, complete mode): `pAliq` from the invoice, prefilled with the emitter's ISS rate | PIS/COFINS CST from the service | Informative, CST and `cClassTrib` from the service, no values | none |
| Abroad | `tribISSQN` 3 (export, immune), `cPaisResult` the customer's country, no `pAliq` | PIS/COFINS CST from the service | Informative, export CST and class from the service | `comExt` from the service defaults and the foreign amount |

`pTotTribSN` is the band percent chosen on the invoice (prefilled from the emitter). The ISS rate rule above comes from the [produção restrita check](#produção-restrita-check-stage-2a): the emitter's ISS rate is the default **for retained invoices**, and the screen shows it only when retention is chosen.

### Freezing what was sent

The built template is stored on the pending invoice row, in the same transaction that reserves the DPS number. Reconcile and every resend use that stored template, never a rebuild, so an edit to the customer or the service between the first send and a resend cannot change the invoice.

## Tax Reform (IBS/CBS)

State as known on 2026-10-10; dates come from technical notes and secondary sources that do not always agree, and each is confirmed against the official technical notes before the stage that depends on it starts.

**2026.** For Simples optants, the IBSCBS group is not required on the NFS-e (NT 004 v2 turned off the mandatory validation; the 0.1% IBS and 0.9% CBS test rates do not apply to the Simples). The NBS code is informed. NotaFlow's export invoices already carry an informative IBSCBS group (CST 410, `cClassTrib` 410027), copied from the template; a built invoice carries the service's CST and class the same way, with no values.

**2027.** From 2027-01-01 the IBSCBS group is required from Simples optants as well. NT 009/2026 adds `vReceitaBrutaSN` and a field for the IBS/CBS regime. Each Simples company chooses, per half-year:

- **Inside the DAS** (the default): the invoice is informative.
- **Regular regime ("híbrido")**: the invoice highlights base, rates, and IBS/CBS values; the buyer may take a credit.

The option for the regular regime for 2027-H1 runs until 2026-10-30. This is a business decision for each emitter and its accountant, not an app setting NotaFlow can make.

**What this RFC builds for it:**

- The emitter's fiscal configuration holds the IBS/CBS regime with a start date (half-year).
- `taxRules(competence)` makes 2027 a new rule version.
- The 2027 stage adds the `rules2027` version, the new DPS fields of NT 009, and the value calculation, against the published layout and its test environment.

## Data Model

| Table | Change |
| --- | --- |
| `emitters` | `simples_annex` (`III` or `V`), `simples_band` (1 to 6), `simples_percent` (integer, hundredths: 6.00% = 600), `iss_rate` (integer, hundredths), `ibscbs_regime` (`inside_das` or `regular`), `ibscbs_regime_from` (date). Owner-only edits, audited. |
| `services` (new) | `emitter_id`, `name`, `national_tax_code`, `municipal_tax_code`, `nbs_code`, `description`, `pis_cofins_cst`, `ibscbs_operation_code`, `ibscbs_cst`, `ibscbs_class_code`, export defaults (`mode`, `provider_link`, `provider_support`, `customer_support`, `temporary_goods`, `mdic`), `origin` (`imported` or `manual`), `archived`. Imported services are built by the sync from stored invoices, one per distinct service code and description, and are never overwritten after a hand edit (the customer rule). |
| `customers` | Already exists. Gains creation by hand (`origin = manual`) for documents `CNPJ`, `CPF`, `NIF`, or `NONE` (abroad without NIF). The kind (Brazil or abroad) follows from the document and the address. |
| `invoices` | `issue_template` (JSON): the built `DpsTemplate` of an invoice issued without a template; `template_of` stays empty for it. |

The Simples band percents are a table in code, by annex: Annex III 6.00, 11.20, 13.50, 16.00, 21.00, 33.00; Annex V 15.50, 18.00, 19.50, 20.50, 23.00, 30.50. Percents are integers in hundredths, like amounts in cents.

## API

All routes are under `/api/accounts/:accountId` and go through the existing guards and the route sweep.

| Route | Who | What |
| --- | --- | --- |
| `GET/PUT emitters/:emitterId/fiscal` | read: members; write: owner | The fiscal configuration. |
| `GET emitters/:emitterId/services`, `POST`, `PUT services/:serviceId` | read: members; write: owner | Services; archive instead of delete. |
| `GET service-codes?q=` | members | Search the national service code table (embedded, versioned in the repo). |
| `POST customers` | write: owner and member | Create a customer by hand. |
| `POST invoices/new` | write: owner and member | Issue without a template. Body: `emitterId`, `customerId`, `serviceId`, `competence`, `serviceCents`, optional `foreignCurrency` and `foreignAmountCents`, `simplesPercent`, `issRate`, `description`, and the complete-mode overrides. Same `Idempotency-Key` header and same answer as `invoices/issue`. |

## Screens

- **Emitentes:** a "Configuração fiscal" block (annex and band selector showing the percent, ISS rate, IBS/CBS regime) and the emitter's **Serviços** (imported and manual; "Novo serviço" with the national code search).
- **Clientes:** "Novo cliente", asking first Brazil or abroad, then the fields of that kind.
- **Notas → "Nova nota":** the simplified mode (emitter when more than one, customer combobox with "+ Novo cliente" in a dialog, service, competence, description, amount in reais or in the foreign currency with the PTAX, Simples band, ISS with its computed value) and "Mais opções" for the complete mode. Then the same review and result screens as "issue similar", with the same idempotency behavior.

UI text is Brazilian Portuguese, on the Malphas components; the environment rules of the customer view apply.

## Validation and Errors

Checked before a DPS number is reserved, each with its own error code and a Portuguese message:

| Check | Code |
| --- | --- |
| CPF or CNPJ check digits | `invalid_document` |
| Brazil customer without municipality or CEP | `customer_address_incomplete` |
| Foreign customer without a country | `customer_country_missing` |
| Emitter without a fiscal configuration | `fiscal_config_missing` |
| Service without a national code | `service_incomplete` |
| Zero or negative amount | `invalid_amount` |
| Competence after today | `competence_after_issue` |
| Foreign customer without a foreign amount | `invalid_amount` |
| Brazil customer with a foreign amount | `foreign_amount_not_allowed` |
| Competence that is not a calendar date | `invalid_competence` |
| Blank description, or control characters in it | `invalid_description` |
| Customer text the XSD refuses (outside Latin-1, a line break) | `invalid_text` with the field |
| Emitter that is not an ME/EPP Simples optant (`opSimpNac` 3) | `emitter_not_simples` |
| ISS retained for a customer abroad or a CPF | `retention_not_allowed` |
| ISS retained below the legal minimum of the service: 2.00%, or above zero for subitems 7.02, 7.05, and 16.01 (LC 116, art. 8-A) | `invalid_iss_rate` with the minimum |
| Municipality outside the IBGE table, country outside the ISO table (Anexo A) | `unknown_municipality`, `unknown_country` |
| Export amount in reais that is not the foreign amount at the PTAX sell rate of the competence date | `amount_ptax_mismatch` with the expected amount |
| No PTAX rate for the competence date | `ptax_unavailable` (502) |
| CEP lookup: not 8 digits, unknown, ViaCEP down | `invalid_cep`, `cep_not_found` (404), `cep_unavailable` (502) |

Customer text is trimmed, and typographic quotes and dashes become plain ones, before the check. Amounts are at most 9,999,999,999,999 cents and the Simples percent at most 99.99%, the limits of the XSD types.

Sefin refusals keep the existing behavior (`rejected` with the Sefin messages; E0014 through the ownership check).

## Testing and Acceptance

1. **Produção restrita check, first task of the plan** (real certificate, every issued invoice cancelled afterwards, with the list of issued and cancelled invoices): a domestic ME/EPP invoice with ISS, to settle whether `pAliq` is accepted for an optant and which fields the Sefin asks for; and an export invoice built without a template, compared with the emitter's real export invoices. Refusal codes become rules and tests.
2. **Unit:** `buildTemplate` for each combination (Brazil or abroad, each Simples band, ISS, CPF or CNPJ), compared with the expected XML and validated against the official XSD, like the existing builders.
3. **Fake, end to end:** issue without a template, including a resend and a reconcile that use the stored template.
4. **Screens:** the simplified mode for Brazil and abroad, "+ Novo cliente" in the dialog, the fiscal configuration.
5. **Acceptance:** in produção restrita (invoices cancelled), then the first real invoice when Lincoln decides.

## Produção restrita check (Stage 2a)

On 2026-10-10, with the real certificate, invoices built without a template (no `readTemplate`) for the first emitter (Simples ME/EPP, `regApTribSN` 1):

| Variant | Result |
| --- | --- |
| Domestic, synthetic customer CNPJ with wrong check digits | Refused, E0188 "CNPJ do tomador informado na DPS é inválido": the Sefin checks the digits |
| Domestic, not retained, with `pAliq` 2.00 | Refused, E0625: no `pAliq` without ISS retention for an ME/EPP optant whose ISS is apportioned by the Simples |
| Domestic, not retained, without `pAliq` | Issued, then cancelled |
| Domestic, retained (`tpRetISSQN` 2), with `pAliq` 2.00 | Issued, then cancelled |
| Export (country US, NIF, `comExt`, `tribISSQN` 3, IBSCBS CST 410 class 410027), built field by field | Issued, then cancelled |

Issued 3, cancelled 3, none left active. All three carried PIS/COFINS CST 00 and `pTotTribSN`; the domestic ones carried no IBSCBS group.

**Pre-PR check through the server's code path** (`spikes/2026-10-new-invoice/issuerPath.ts`: `buildTemplate`, `NacionalIssuer.issue`, the lookup by DPS id, a resend of the same DPS, and cancel), on 2026-10-10:

| Case | Result |
| --- | --- |
| CNPJ customer in Brazil, ISS not retained | Issued; amount, description, customer, competence, `pTotTribSN`, and `tpRetISSQN` 1 as built |
| CPF customer in Brazil | Issued, same checks |
| CNPJ customer, ISS retained with `pAliq` 2.00 | Issued, `tpRetISSQN` 2 |
| Export in USD with IBSCBS 410/410027 | Issued, `vServMoeda` as built |

Each invoice was found by the DPS id the server stores, and a resend of the same DPS came back as the same invoice (E0014 recovery). Issued 4, cancelled 4.

## Open Questions

- [x] Does the Sefin accept `pAliq` on a domestic invoice of an ME/EPP Simples optant? Only when the ISS is retained by the customer (`tpRetISSQN` 2); without retention it refuses `pAliq` with E0625. See [Produção restrita check (Stage 2a)](#produção-restrita-check-stage-2a).
- [x] The source and update path of the national service code table (`cTribNac` list) to embed. Source: Anexo B v1.01 of 2026-01-22 (sheet `LISTA.SERV.NAC.`, 338 codes) from the NFS-e [Documentação Atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual). It is `apps/server/src/data/serviceCodes.json`. A new Anexo B version is converted again and committed.
- [ ] The default PIS/COFINS CST and IBS/CBS class for a domestic service of a Simples optant in 2026, confirmed with the accountant or the Sefin check.
- [ ] NT 009 rollout schedule, for the 2027 stage.
