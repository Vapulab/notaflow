# RFC: NotaFlow NFS-e Emitter

**Status:** In Review
**Date:** 2026-10-08
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [Sistema Nacional NFS-e](https://www.nfse.gov.br/) (official portal, technical docs, XSD schemas)
- [Manual for Sefin API users, v1.2](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf)
- [Manual for ADN API users](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf)
- [XSD bundle 2026-07-27, alphanumeric CNPJ](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas-nfse-rtc-v1-01-20260727.zip)

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution](#solution)
4. [Design](#design)
5. [Data Model](#data-model)
6. [Security](#security)
7. [Delivery Stages](#delivery-stages)
8. [Testing](#testing)
9. [Documentation](#documentation)
10. [File Locations](#file-locations)
11. [Stage 0 Results](#stage-0-results)
12. [Open Questions](#open-questions)

---

## Overview

NotaFlow is a multi-tenant web app that issues and cancels Brazilian service invoices (NFS-e). Its main feature: open an invoice that was already issued, and issue a new one with the same fields. The user changes only what is different, usually the competence date, the amounts, or the customer.

Each tenant uploads its own A1 digital certificate. The app issues invoices with the CNPJ of that certificate. The first tenant is Vapulab, which issues monthly invoices to CoGrader.

The first provider is the national system (Sistema Nacional NFS-e: Sefin Nacional and ADN). The design puts every invoice system behind a provider interface, so municipal systems (ABRASF) or NF-e can come later.

The product will charge for access in the future. The code is public on GitHub under the Business Source License.

---

## Problem Statement

A company that issues the same invoice every month must fill the same form in the national portal (Emissor Nacional) every time. The portal has no "copy this invoice" action. The customer, the service code, the description, and the tax fields are typed again each month. Each manual entry is a chance for an error that requires a cancellation.

The national system has a REST API, but it requires mTLS with an ICP-Brasil certificate and XMLDSig-signed XML. A small company cannot use the API without a tool.

---

## Solution

A web app that:

1. Stores each tenant's certificate, encrypted.
2. Syncs every invoice the tenant issued from the ADN, and keeps a local list with history.
3. Opens any invoice, by list or by access key, as a pre-filled form.
4. Keeps a customer register, filled automatically from synced invoices and editable by hand.
5. Issues a new invoice from an invoice or from a customer, with a review step that shows what changed.
6. Cancels issued invoices.

Users log in through Cloudflare Access. The app decides who can do what, through accounts and roles.

---

## Design

### Architecture

```
notaflow.vapulab.com
   │  Cloudflare Access (email one-time PIN now, Google later)
   ▼
cloudflared ──► server (Fastify) ──► provider "nacional" ──► Sefin / ADN (mTLS)
 (container)       │   also serves the web build
                   ├──► Signer (Node or Python sidecar, chosen by the Stage 0 spike)
                   └──► SQLite (Docker volume), certificates encrypted at rest
```

The app runs on the Vapulab VPS at Hostinger (Ubuntu 24.04, Docker), next to the Vapulab app. The app container publishes no host port. Only the shared northub `cloudflared` container reaches it, on the Docker network `northub_default`. A merge to `production` deploys it; see [Deploy on the Vapulab VPS](../../../TUTORIALS/DEPLOY_ON_VM.md).

### Packages

pnpm monorepo, TypeScript end to end.

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `packages/core` | Pure domain: `Account`, `Emitter`, `Customer`, `Invoice`, `DraftInvoice`. Defines the ports `InvoiceProvider`, `InvoiceIssuer`, `Signer`, `CertificateStore`, and the repositories. No I/O. | nothing |
| `packages/provider-nacional` | `InvoiceProvider` for the national system: build the DPS, issue, query, sync the ADN, cancel. Converts XML to and from the `core` model. | `core` |
| `packages/signer-node` | `Signer` with `xml-crypto` and `node-forge`. | `core` |
| `services/signer-py` | `Signer` as a FastAPI sidecar with `signxml` and `lxml`. Exists only if the spike needs it. | none |
| `apps/server` | HTTP API, persistence (Drizzle and SQLite), certificate vault, sync jobs, authorization. Wires ports to implementations. | all of the above |
| `apps/web` | React and Vite UI. | `server` API |

Rules:

- `core` does not know XML, HTTP, or the database.
- A new provider is a new package that implements `InvoiceProvider`. It does not change `core` or the UI.
- Production runs one app container. The server serves the static web build. The Python sidecar is an optional Compose service.

### Signer decision

XMLDSig canonicalization is the main technical risk in Node. Signing sits behind the `Signer` port. In Stage 0, a spike signs the same DPS with both implementations and sends each to the national test environment (produção restrita).

- If the Node signer is accepted, the project stays on one stack. The Python sidecar stays documented as plan B.
- If the Node signer fails, the Python sidecar is enabled. Nothing outside the port changes.

The spike result is recorded in this RFC.

**Decision (2026-10-08): the Node signer, with the `rsa-sha256-exc-c14n` profile as the default.** The Sefin accepted both Node profiles. It refused both Python signatures before the signature check (see [Stage 0 Results](#stage-0-results)). The Python sidecar stays documented as plan B.

### Flow: onboard an emitter

1. An `owner` uploads the `.pfx` file and its password.
2. The app opens the certificate, reads the CNPJ and the company name, and checks the validity dates. It refuses a CNPJ that already belongs to another account.
3. The user completes what the certificate does not carry: municipal registration, municipality (IBGE code), tax regime, and DPS series.
4. Connection test: a read-only mTLS call, `GET {adn}/parametrizacao/{cMun}/convenio`. The old Sefin municipal-parameter paths return 501. On success, the certificate becomes active and the first sync starts.
5. A new emitter starts in `producao`, and the connection test runs there (decided by Lincoln on 2026-10-10: customers work in production only). Produção restrita is a test tool of the platform admin: only a platform `admin` who is a member of the account can switch an emitter's environment; a switch to `producao` needs an explicit confirmation, and every switch goes to the audit log. The UI shows a large badge with the environment where it matters (invoice detail, issue review, cancel dialog), and the invoice list marks produção restrita invoices with a "Teste" badge.

### Flow: sync from the ADN

- One job per emitter, every 30 minutes, plus a "sync now" button.
- The job reads `/DFe/{NSU}` from the stored cursor. For each document:
  - An NFS-e where the emitter is the provider: upsert the invoice by access key, and upsert the customer by document.
  - An event (for example, a cancellation made here or in the portal): store the event and set the invoice to `cancelled`.
  - An invoice where the emitter is the customer (received invoice): skip in Stage 1. The cursor still moves.
- The cursor is saved in the same transaction as each batch. A crash resumes from the last saved batch, with no duplicates.
- On HTTP 429 or 5xx, the job backs off, retries, and records the error in `sync_state`.
- A customer field that a user edited by hand is never overwritten by the sync.

### Flow: find by access key

The user pastes a 50-digit access key. The app calls `GET /nfse/{accessKey}`, checks that the provider of the invoice is an emitter in the user's account, stores it through the same path as the sync, and opens it.

### Flow: issue a new invoice

Two entry points:

- **From an invoice** ("issue similar"): the provider parser turns the stored XML into a `DraftInvoice`. Every field is pre-filled.
- **From a customer** ("issue for this customer"): the form uses the customer record and copies service and amounts from the customer's last invoice. With no previous invoice, the service fields are empty.

Steps:

1. **Form.** The user can edit the competence date, amounts, description, service, and customer. For an export invoice, the BRL amount is suggested from the PTAX sell rate of the closing bulletin on the competence date (or the last business day before it) and stays editable. The customer field searches the register and offers "new customer", which saves the record with the issue. The issue date is always "now", because the Sefin refuses a future date.
2. **Review.** A confirmation screen shows the environment, the computed taxes, and every field that differs from the template, highlighted.
3. **Send, protected against duplicates.**
   - In one transaction, the app reserves the next DPS number and creates the invoice with `status = pending`. The number is never one that the emitter already used in its series.
   - It builds the DPS, signs it, and sends it.
   - Success: `issued`, with access key and XML.
   - Validation rejection: `rejected`. The form shows the Sefin messages next to the fields.
   - Uncertain result (timeout or 5xx): `unknown`. The app never resends blindly. It first queries the Sefin by DPS id. It resends only if no invoice exists for that DPS.

### IBS/CBS group on domestic invoices

From the NT 009 layout, a domestic DPS carries the `IBSCBS` group. The group takes its codes from the service. A service without codes gets the defaults for its LC 116 item, from the Anexo VIII v1.02.00 (`packages/provider-nacional/src/rules/ibsCbsDefaults.ts` and `anexo8.json`). An item without a `cClassTrib` keeps its `INDOP` and uses `000001`. The `99.xx` items are out of scope. `indFinal` is 1 for a CPF customer and 0 otherwise. `indDest` and `finNFSe` are 0. A copy ("issue similar", a resend) gets the defaults at issue time, with `indFinal` from the final customer. A domestic override typed in "More options" applies to that invoice. Production keeps the NT 004 output until `NT009_FROM` (2026-12-01, in `src/dps/layout.ts`). Produção restrita accepted the CNPJ case on 2026-10-28. The `indFinal` 1 case still needs a real CPF, because the Sefin refused the synthetic one (E0207).

The layout follows `issuedAt` (the send time minus 60 s). A domestic invoice sent in the first minute of 2026-12-01 still goes out as NT 004. If the Sefin refuses it with E0855, a retry fixes it.

After the switch, a copy of a pre-switch invoice uses the Anexo VIII defaults. It does not use codes the service had only on paper. This holds until the service has its own codes.

### Flow: cancel

1. On an issued invoice, "Cancel" opens a dialog with the reason (the fixed Sefin list) and a justification (minimum length from the Sefin rules).
2. The confirmation shows invoice number, customer, amount, and environment.
3. The app builds the cancellation event request, signs it with the same `Signer`, and sends it to `/nfse/{accessKey}/eventos`. On success it stores the event and sets the invoice to `cancelled`.
4. If the Sefin refuses (for example, the municipal deadline expired), the app shows the message.

### Invoice status

```
pending ──► issued ──► cancelled
   │
   ├──► rejected
   └──► unknown ──► issued | rejected   (after reconciliation)
```

---

## Data Model

The official XML of each invoice is the source of truth. It is stored in full, compressed. The columns are a projection for listing and filtering. "Issue similar" always rebuilds the form from the XML, so no field is lost.

Amounts are integer cents. Timestamps are UTC. The competence date is `YYYY-MM-DD`.

### Tenancy

| Table | Fields | Notes |
| --- | --- | --- |
| `accounts` | name, `status` (`active` / `suspended`), `plan` (free text for now), created at | The paying customer of NotaFlow. |
| `users` | email, name, `platform_role` (`admin` / `user`), last login | A person. |
| `memberships` | `user_id`, `account_id`, `role` (`owner` / `member`) | A person can belong to more than one account, for example an accountant. |

### Fiscal data

| Table | Fields | Notes |
| --- | --- | --- |
| `emitters` | `account_id`, CNPJ (`[0-9A-Z]{14}`, the alphanumeric CNPJ of the 2026-07-27 XSD), company name, municipal registration, municipality (IBGE), tax regime, `provider` (`nacional`), `environment` (`producao` / `producao_restrita`), DPS series, next DPS number | CNPJ unique across the platform. |
| `certificates` | `emitter_id`, encrypted `.pfx`, encrypted password, wrapped data key, CNPJ, subject, valid from, valid to, SHA-256 fingerprint, `active`, uploaded by, uploaded at | One active certificate per emitter. History is kept. |
| `customers` | `emitter_id`, document type (CNPJ / CPF / foreign NIF), document, name, municipal registration, structured address (street, number, complement, district, IBGE municipality, ZIP), email, phone, `origin` (`manual` / `imported`), `archived`, list of fields edited by hand | Document unique per emitter. Archive hides, never deletes. |
| `invoices` | `emitter_id`, `customer_id`, access key, NFS-e number, DPS series and number, `status`, issued at, competence, customer document and name, service code, service amount, ISS, net amount, `origin` (`synced` / `app`), `template_of`, compressed XML, Sefin messages, `created_by` | Access key unique, so the sync does not duplicate an invoice issued by the app. |
| `invoice_events` | `invoice_id`, type, reason code, justification, protocol, compressed XML, `created_by` | |
| `sync_state` | `emitter_id`, last NSU, last run, last error | |
| `audit_log` | user email, account, action, entity, result, at | Certificate upload, environment switch, issue, cancel, user and account changes. |

The invoice keeps its own copy of the customer data in the XML. A fix to the customer record does not change past invoices. The next invoice uses the new data.

---

## Security

The main threat: a person who gets into an account can issue and cancel invoices with that company's CNPJ. The second threat: one account reads another account's data or certificate.

### Authentication and authorization

- **Cloudflare Access authenticates.** It proves the person owns the email. The Access policy accepts any authenticated email. Login is one-time PIN by email now. Google becomes an identity provider later, in the Cloudflare dashboard, with no app change.
- **The app authorizes.** The server validates the Access JWT (`Cf-Access-Jwt-Assertion`) against the team public keys and the application `AUD`. The email from the token must exist in `users`. An unknown email sees "access not granted".
- **The first user** is `lincoln.giacomini@gmail.com` with `platform_role = admin`. A seed command creates it at install time.
- **Local development** uses `AUTH_MODE=dev` with a fixed email. The server refuses to start with `AUTH_MODE=dev` and `NODE_ENV=production`.
- **Mutations** require `Content-Type: application/json` and an `Origin` equal to the app domain. This blocks CSRF with the Access cookie.

### Roles

| Role | Can |
| --- | --- |
| `admin` (platform) | Admin panel: create and suspend accounts, add users, set the `owner` of each account. Cannot see invoices or certificates of an account by default. The only role that switches an emitter between `producao` and `producao_restrita`, in an account where the admin is a member. |
| `owner` (account) | Everything in the account (always in production): certificates, emitters, invite `member`s, issue, cancel, customers. |
| `member` (account) | Issue, cancel, manage customers. No access to certificates or users. |

A `suspended` account can log in and read, but cannot issue or cancel. This is the hook for billing.

### Account isolation

- Every database query goes through a repository that requires the account context. No route queries a table directly.
- A test walks every registered route. It checks that each route requires authentication and enforces the account. It also logs in as account A, requests data of account B, and expects 404.

### Certificate vault

- Envelope encryption: each certificate has its own data key (AES-256-GCM). The data key is wrapped by `NFSE_MASTER_KEY`. A master key rotation re-wraps the data keys only.
- The certificate is decrypted in memory only, to sign or to open the mTLS connection. It never goes to disk in clear text and never goes to a log.
- The UI shows the certificate validity and warns 30 days before it expires.
- If the master key is lost, stored certificates become unreadable. Users upload the `.pfx` again. Invoices are not lost.

### Secrets and the public repository

- Secrets live only in the VM `.env` file, mode `600`: `NFSE_MASTER_KEY`, `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`, `TUNNEL_TOKEN`. The repository has only `.env.example`.
- `.gitignore` blocks from the first commit: `*.pfx`, `*.p12`, `*.pem`, `.env*` except `.env.example`, and `data/`.
- A `gitleaks` pre-commit hook, plus GitHub secret scanning and push protection.
- Tests generate a self-signed certificate at run time and use synthetic XML with fake CNPJs and amounts. No real invoice enters the repository.
- Logs never contain a certificate, a password, the master key, or a full XML. They contain the access key, the status, and Sefin error codes.

### Container

- The app runs as a non-root user, with a read-only file system except the `data/` volume.
- Dependabot keeps dependencies current.

### Recovery

- The ADN is the backup for invoices. After a VM loss: deploy again, upload the `.pfx`, reset the cursor. The sync rebuilds invoices, events, and imported customers.
- Data that exists only in the database: accounts, users, manual customer data, the audit log, and DPS numbering. A daily `sqlite3 .backup` on the VM covers it in Stage 1.
- The master key is kept in a password manager, never next to the backup.

---

## Delivery Stages

| Stage | Delivers | Done when |
| --- | --- | --- |
| **0. Spike** | Repository and docs skeleton. A script that signs one DPS with both signers, issues and cancels in produção restrita, and reads `/DFe`. | Signer decision recorded here. The three spike questions below have evidence. |
| **1a. Read** | `core`, `provider-nacional` (parser, sync, access-key lookup), certificate vault, accounts, users, roles, admin panel. | Vapulab account created, certificate uploaded, invoices issued to CoGrader listed from the ADN. |
| **1b. Write** | Customer register, issue from invoice or customer, cancel. | In produção restrita: issue similar, edit amounts and customer, cancel. A simulated timeout ends in `unknown` and reconciles with no duplicate. |
| **1c. Production** | Docker Compose on the VM, `cloudflared`, Access application, daily backup, DNS migration checklist. | `notaflow.vapulab.com` is live. The first real Vapulab invoice to CoGrader is issued, with Lincoln watching. |

### Planned, not in Stage 1

- Upload of an invoice XML as a template.
- CNPJ lookup to fill customer data (BrasilAPI).
- Off-VM backup (for example Cloudflare R2).
- Billing, self-service signup, admin support access with audit.
- Cancellation by substitution and the fiscal analysis request.
- Other providers (ABRASF municipal systems, NF-e).
- Email delivery of the invoice to the customer.
- Local DANFSe (PDF) renderer in the national layout. The ADN DANFSe API is suspended since 2026-08-03 (NT 008/2026). Lincoln decides in Stage 1b if it moves into Stage 1. Update: NotaFlow now draws the DANFSe from the stored XML; see [RFC: DANFSe PDF Generation](RFC_DANFSE_PDF.md).
- Postgres.
- Terms of use and privacy policy (LGPD). Required before the first paying customer, because the app stores third-party A1 certificates.

---

## Testing

- **Unit (Vitest):** `core` rules, such as tax computation in cents and status transitions.
- **Provider:** synthetic XML fixtures. A round-trip test (XML to draft to DPS) that loses no field. The generated DPS validates against the official XSD schemas, which are public and live in the repository.
- **Signer:** each implementation signs, and an independent verifier checks the signature. The two implementations verify each other.
- **Server:** the route sweep for authentication and isolation. Integration tests against a mocked Sefin: rejection, timeout to `unknown` to reconciliation, and 429 during sync.
- **Local fake (`packages/fake-nacional`):** an in-memory Sefin and ADN for development and for server integration tests. It copies behavior seen from the real system, such as E0014, E1229, and the JSON 404. It does not check signatures.
- **End to end in produção restrita:** runs locally only, with a real certificate. Never in CI.
- **CI (GitHub Actions):** lint, typecheck, tests, `gitleaks`.

---

## Documentation

The repository follows the CoGrader documentation standard. All docs are in English and follow the writing standard (inverted pyramid, Simplified Technical English).

```
AGENTS.md                         router and global rules
docs/README.md                    category hub
docs/ENGINEERING/
  ARCHITECTURE/                   OVERVIEW, TENANCY, PROVIDERS, CERTIFICATE_VAULT, INVOICE_LIFECYCLE
  CONVENTIONS/                    DOCUMENTATION_STANDARD, WRITING_STYLE, SECRETS, CODE_COMMENTS
  RFCS/2026/10/RFC_NFSE_EMITTER.md
  PLANS/2026/10/PLAN_STAGE_1A_1_PROVIDER_READ.md
  PLANS/2026/10/PLAN_STAGE_1A_2_SERVER_FOUNDATION.md
  PLANS/2026/10/PLAN_STAGE_1A_3_SYNC_AND_UI.md
docs/TUTORIALS/                   DEPLOY_ON_VM, MIGRATE_DNS_TO_CLOUDFLARE, ONBOARD_ACCOUNT
docs/TEMPLATES/                   RFC, PLAN, TUTORIAL
```

Each package has a short `AGENTS.md` that points into `docs/`. File and folder names use `SCREAMING_SNAKE_CASE`. Dated categories use `YYYY/MM/`.

---

## File Locations

| Path | Purpose |
| --- | --- |
| `packages/core/src/` | Domain types, ports, rules |
| `packages/provider-nacional/src/` | DPS builder, XML parser, Sefin and ADN clients |
| `packages/provider-nacional/schemas/` | Official XSD files |
| `packages/signer-node/src/` | Node `Signer` |
| `services/signer-py/` | Python `Signer` sidecar (only if needed) |
| `apps/server/src/` | API, repositories, vault, jobs, auth |
| `apps/web/src/` | UI |
| `deploy/docker-compose.yml` | App, `cloudflared`, optional signer |
| `LICENSE` | Business Source License 1.1 |

---

## Stage 0 Results

Two runs of `pnpm spike:sefin` against produção restrita on 2026-10-08, with a Simples Nacional ME/EPP emitter in Londrina (IBGE 4113700) and an export DPS (foreign customer with NIF, `tribISSQN` 3, `comExt`, and the `IBSCBS` group). The emitter has no municipal registration, and the Sefin accepted the DPS without `IM`.

| Step | Result |
| --- | --- |
| 1. Connection test (`/parametrizacao/{cMun}/convenio`) | HTTP 200, municipality joined the national emitter |
| 2. Node signer, `rsa-sha1-c14n` | Issued |
| 2. Node signer, `rsa-sha256-exc-c14n` | Issued |
| 3. Python signer, both profiles | Rejected, E1228 "Xml declarado com prefixo de namespace" (signxml writes the `ds:` prefix) |
| 4. DPS number reuse | Not answered: the DPS with a zero amount was issued, not rejected. The resend of the same number got E0014 |
| 5. Get NFS-e by access key | HTTP 200, XML returned |
| 6. Cancel (event 101101) | Registered, with SHA1 and with SHA256 signatures |
| 7. `GET /dps/{id}` for an unknown DPS | HTTP 404 with a JSON body, `not_found` |
| 8. ADN DFe from NSU 0 | `NENHUM_DOCUMENTO_LOCALIZADO`, although the emitter had issued invoices minutes before |

Every invoice the spike issued was cancelled the same day.

Surprises, all handled in `NacionalClient` or recorded here:

- The first run got E1229 "Xml não está utilizando codificação UTF-8" for every DPS. The Sefin needs the `<?xml version="1.0" encoding="UTF-8"?>` declaration. The client adds it.
- Sefin error objects use `Codigo` and `Descricao`, capitalized. Some error bodies arrive in Latin-1 (seen with E0014). The client handles both.
- The Sefin issued a DPS with a zero service amount. The app must refuse a zero amount itself.
- A cancellation request for an invoice that is already cancelled got a rejection whose body is not in the `erro` shape the client reads. Capture the raw body before Stage 1a maps event errors.
- The ADN returned no documents for the emitter right after the issues. Stage 1a answered it: the restrita ADN delivers them later (see Stage 1a acceptance).

### Production ADN read (Stage 1a-1, 2026-10-09)

A read-only run of `pnpm spike:adn-read` against the production ADN, with the emitter's certificate. It only read the feed and looked up one invoice by access key.

- Documents read: 6, all `TipoDocumento` `NFSE`. 3 are the emitter's own invoices, and the parser read all 3 with no error. 3 are invoices where the emitter is the customer, skipped as `received invoice`. No event.
- `/DFe/{NSU}` is exclusive of `NSU`: from NSU 0 the first document had NSU 1, and from the last NSU (6) the ADN returned no document.
- The production ADN returns the emitter's invoices, unlike produção restrita in Stage 0. The empty feed there remains open.
- `getInvoice` by access key returned the invoice.

### Stage 1a acceptance (2026-10-09)

Stage 1a is accepted. On the owner's machine, with the real certificate:

- The account, the owner, and the emitter were created through the UI, and the connection test passed in produção restrita.
- The first sync after onboarding read produção restrita and stored the 3 invoices of the Stage 0 spike, all cancelled. So the restrita ADN does deliver the emitter's documents; in Stage 0 it had not processed them yet when the spike read it minutes after the issues.
- After the switch to production (audited), "Sincronizar agora" listed the emitter's 3 production invoices, all issued. Invoices where the emitter is the customer were not listed. Nothing was issued or cancelled.

### Stage 1b acceptance (2026-10-09)

Stage 1b is accepted in produção restrita, on the owner's machine, with the real certificate and the Malphas screens:

- The emitter was switched to produção restrita. "Emitir parecida" from a Stage 0 spike invoice (an export template) filled the BRL amount from the real PTAX (sell, closing bulletin, 2026-09-30) and showed the changed fields in the review.
- A double click on "Emitir em produção restrita" issued one invoice: one pending row, one audit entry, one NFS-e.
- The invoice was cancelled through the dialog (reason 9). The Sefin registered event 101101, and the invoice ended `cancelled`.
- A second cancel of the same invoice was refused with HTTP 400 and `E0840` ("o evento de Cancelamento de NFS-e já está vinculado à NFS-e"). The code is the one the app already treats as "already cancelled". The body carries `erro` as an **array**, a shape the client did not read; the client now reads it (test first).
- Counts: 1 invoice issued, 1 cancelled, none left active. The emitter went back to production afterwards, and its production invoices were not touched.

### Stage 1c acceptance (2026-10-10)

NotaFlow runs at `https://notaflow.vapulab.com` on the Vapulab VPS, deployed by GitHub Actions on every merge to `production` (see [Deploy on the Vapulab VPS](../../../TUTORIALS/DEPLOY_ON_VM.md)). Cloudflare Access protects it with a one-time PIN by email; the Access policy must be a reusable policy, because an inline one denied every login. With the real certificate, the owner logged in, created the Vapulab account, onboarded the emitter (connection test in produção restrita), switched it to production, and synced: the 3 production invoices are listed as issued, and the 4 produção restrita test invoices as cancelled. The first real invoice to CoGrader is the owner's call.

## Open Questions

- [ ] Can a rejected DPS number be reused, or is it consumed? Still no evidence: the spike's invalid DPS (zero amount) was issued. Until it is answered, the app never reuses a number; a rejected row keeps its number, and the next issue takes a new one.
- [x] The endpoint to query an invoice by DPS id: `GET /dps/{id}`. HTTP 404 means no NFS-e exists for that DPS.
- [x] Cancellation reason codes (`cMotivo`): 1 Erro na Emissão, 2 Serviço não Prestado, 9 Outros. The justification (`xMotivo`) has 15 to 255 characters.
- [x] Node or Python `Signer`: Node, `rsa-sha256-exc-c14n` by default. See [Signer decision](#signer-decision).
- [x] The Sefin error code for "an NFS-e already exists for this DPS" is E0014 ("Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente"). Stage 1a maps E0014 to a lookup by DPS id, not to `rejected`.
- [x] The Sefin code for "cancellation already registered" is E0840, in a body where `erro` is an array (Stage 1b acceptance).
- [ ] BSL parameters. Proposal: Change Date four years after each release, Change License Apache-2.0, no Additional Use Grant (production use needs a commercial license).
- [x] DNS: `vapulab.com` is already a Cloudflare zone of Lincoln's account, so no nameserver migration is needed. Stage 1c points `notaflow.vapulab.com` at the VM.
