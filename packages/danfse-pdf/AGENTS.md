# DANFSe PDF: AI Context

Draws the DANFSe PDF (NT 008 v1.02) from the invoice XML. The national ADN endpoint that served it was suspended on 2026-08-03.

## Quick Reference

- Entry point: `src/index.ts`
- Layout table: `src/layout.ts` (`BLOCKS`, `FIELDS`), transcribed from NT 008 item 2.4.5. Units are cm from the top-left.
- Spec and assets: `spec/` (the NT PDF), `assets/` (Liberation Sans fonts, NFS-e logo). Each folder has a `SOURCE.md`.
- Depends on: `@notaflow/core` (`/places` subpath), `@notaflow/provider-nacional`, `pdf-lib`, `@pdf-lib/fontkit`, `qrcode`.

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - packages and ports

## Key Rules

1. Print only data from the XML. Nothing from NotaFlow on the page.
2. Field positions come from the NT table. Do not move a field without a new NT version.
