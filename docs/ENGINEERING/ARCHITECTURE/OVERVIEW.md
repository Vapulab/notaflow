# Architecture Overview

NotaFlow is one app container behind a Cloudflare tunnel. A Fastify server holds the domain, the certificate vault, and the jobs, and it serves the React UI. Each invoice system is a provider package behind a port. The full design is in the [RFC](../RFCS/2026/10/RFC_NFSE_EMITTER.md).

```
notaflow.vapulab.com
   │  Cloudflare Access (email one-time PIN now, Google later)
   ▼
cloudflared ──► server (Fastify) ──► provider "nacional" ──► Sefin / ADN (mTLS)
 (container)       │   also serves the web build
                   ├──► Signer (Node, or the Python sidecar)
                   └──► SQLite (Docker volume), certificates encrypted at rest
```

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | Domain types and ports. No I/O. |
| `packages/test-kit` | Test-only helpers, such as self-signed e-CNPJ certificates. |
| `packages/signer-node` | Loads a `.pfx` and signs XML (`Signer` port). |
| `packages/provider-nacional` | DPS and event XML, and the Sefin and ADN client. |
| `packages/fake-nacional` | In-memory fake of the Sefin and the ADN for development and tests. Never in production. |
| `services/signer-py` | Python `Signer`, kept as plan B. |
| `apps/server` | API, persistence, vault, authorization (Stage 1a-2); sync jobs (Stage 1a-3). |
| `apps/web` | React UI, built with Vite and served by the server (Stage 1a-3). |

## Ports

**`Signer`** signs one element of an XML document by its `Id`, and places the `Signature` right after that element. It has two profiles: `rsa-sha1-c14n` and `rsa-sha256-exc-c14n`. The Stage 0 spike decides which implementation and profile production uses.

**`InvoiceProvider`** is what an invoice system implements. The read side (Stage 1a) checks the connection, fetches documents since a cursor (`fetchSince`), and gets one invoice by access key. `NacionalProvider` is the national implementation.

**`InvoiceIssuer`** issues a new invoice from a source, finds an invoice by DPS id, and cancels. The source is a stored NFS-e to copy (`stored`) or a template built from the emitter, the service, and the customer (`built`, from `buildTemplate`). `NacionalIssuer` is the national implementation. See [Invoice Lifecycle](INVOICE_LIFECYCLE.md).

**`CertificateStore`** stores and loads tenant certificates. Each certificate is encrypted with its own data key, and `NFSE_MASTER_KEY` wraps that key. See [Certificate Vault](CERTIFICATE_VAULT.md); accounts and roles are in [Tenancy](TENANCY.md).

## Rules that hold across packages

- `core` does not import XML, HTTP, or database code.
- Every XML builder validates against the official XSD in a test.
- mTLS uses the PEM key and certificate from `loadCertificate`, never the raw `.pfx`.
- The ADN sync (cursor per environment, retries, document rules) is in [ADN Sync](SYNC.md).
