# Core: AI Context

The domain types and the ports (interfaces) that every other package implements or consumes. No I/O.

## Quick Reference

- Entry point: `src/index.ts`
- Ports: `Signer` (`src/ports/Signer.ts`), `InvoiceProvider` (`src/ports/InvoiceProvider.ts`, read side). `CertificateStore` (`src/ports/CertificateStore.ts`).
- Domain: `ProviderInvoice`, `ProviderEvent`, `InvoiceParty` (`src/domain/ProviderInvoice.ts`). Tenancy: `AccountContext`, `AdminContext` (`src/domain/Tenancy.ts`).
- Node-only subpath: `@notaflow/core/places` (`src/places/`), the municipality and country lookup. It is the only Node-only code here; never import it in the browser.
- Depends on: nothing.

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - packages and ports

## Key Rules

1. Never import XML, HTTP, database, or Node-only modules here.
