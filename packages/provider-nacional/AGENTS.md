# Provider Nacional: AI Context

The national NFS-e system (Sefin Nacional and ADN): builds the DPS and the event XML, and calls the APIs over mTLS.

## Quick Reference

- Browser entry: `@notaflow/provider-nacional/simples` (`src/simples.ts`): the Simples month calculation, `annexRule`, and `ibsCbsDefaults`, with no HTTP or signer code
- Entry points: `NacionalProvider` (the `InvoiceProvider`), `parseNfseXml`, `parseEventXml`, `buildDpsXml`, `buildCancelEventXml`, `NacionalClient`, `createMtlsDispatcher` (`src/index.ts`)
- Local fake for development and tests: `packages/fake-nacional` (pass its `urls` to `NacionalClient`)
- Schemas: `schemas/` (official XSD, see `schemas/SOURCE.md`)
- Depends on: `@notaflow/core`, `undici`. Tests need Python with `lxml` (`tools/xsd/requirements.txt`).

## Documentation Index

- [RFC: NotaFlow NFS-e Emitter](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and API facts
- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - where the provider sits

## Key Rules

1. Every XML builder has a test that validates against the vendored XSD.
2. `src/rules/ibsCbsDefaults.ts` maps an LC 116 item to its IBS/CBS defaults. It reads `src/rules/anexo8.json`, made from the Anexo VIII v1.02.00. To regenerate: `python scripts/anexo8.py <anexo8.xlsx>` (needs `openpyxl`, not run in CI).
3. `NT009_FROM` in `src/dps/layout.ts` sets when production switches from the NT 004 layout to NT 009.
4. Update `schemas/` only from the official gov.br zip, and record the URL and date in `schemas/SOURCE.md`.
