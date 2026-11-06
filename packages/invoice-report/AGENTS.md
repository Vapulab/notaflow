# Invoice Report: AI Context

Builds the period summary and draws the branded PDF report of NFS-e invoices.

## Quick Reference

- Entry point: `src/index.ts`
- Period helpers: `src/period.ts` (also exported as `@notaflow/invoice-report/period`)
- Summary math: `src/summarize.ts`
- PDF: `src/renderReport.ts` (pages), `src/summaryPage.ts` (page 1), `src/invoiceTable.ts` (list pages), `src/pageFrame.ts` (list header, footer), `src/draw.ts` (fonts, money, logo)
- Sample PDFs: `pnpm --filter @notaflow/invoice-report exec tsx scripts/sample.ts` writes to `sample/` (git-ignored) and prints the 6,000-row render time
- Depends on: `@notaflow/provider-nacional`, `pdf-lib`, `@pdf-lib/fontkit`.

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - packages and ports

## Key Rules

1. Every number comes from `ReportFields` only. Never read an amount from another source.
2. `src/period.ts` must not import pdf-lib. The web app uses it.
