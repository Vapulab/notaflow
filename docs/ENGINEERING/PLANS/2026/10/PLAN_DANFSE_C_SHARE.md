# DANFSe Plan C: Public Link, Sharing, and E-mail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can copy or share a public link to an invoice's DANFSe, NotaFlow can e-mail it to the customer by hand or after each issue, and the link page carries the NotaFlow call to action.

**Architecture:** A new table `invoice_links` holds one random token per invoice. A public API (`/api/public/n/:token`) returns a short summary and the PDF. A static Vite page `n.html`, served for `/n/:token`, renders the summary, the "Baixar PDF" button, and the NotaFlow block, and sends a PostHog event through the site script that the landing and the guide already use. The NotaFlow e-mail goes through the existing mail outbox. A per-emitter setting sends it after each issue.

**Tech Stack:** Fastify, drizzle + SQLite, React (the app screens), the Vite multi-page build (`apps/web/*.html`, `apps/web/src/site`), the mail outbox, prom-client.

**Spec:** [RFC: DANFSe PDF Generation](../../RFCS/2026/10/RFC_DANFSE_PDF.md), sections Decisions, Download and Public Link, Screens, Data Model. Plans A and B are merged (#96, #97).

## Global Constraints

- Token: 32 random bytes, base64url, stored in plain text, unique. One active link per invoice; "Copiar link" and "Compartilhar" always give the same URL. Revoke is a soft delete; a revoked token answers 404.
- Link URL: `${APP_ORIGIN}/n/<token>`.
- Public summary fields only: emitter name, invoice number, issue date, net amount, status notice ("Nota cancelada" / "Nota substituída" from the DANFSe mark), test-environment flag. Never the customer name, document, or address.
- Link state rules: cancelled or substituted invoice works (PDF with the watermark, plus the notice); suspended account works; soft-deleted invoice, emitter, or account answers 404; produção restrita allowed.
- The public PDF uses the same R2-or-draw path as the member download (one shared function).
- Public routes: rate limit 60 per minute per IP; `x-robots-tag: noindex`; `/n/` disallowed in robots.txt.
- Call to action: links to `${APP_ORIGIN}/?utm_source=danfse_link&utm_medium=referral&utm_campaign=nota` (and the same URL as a QR code).
- Share text: "Segue a NFS-e nº <number> de <emitter>: <link>". WhatsApp: `https://wa.me/?text=<encoded text>`. mailto with subject "NFS-e nº <number> de <emitter>" and the text as body.
- NotaFlow e-mail: new `MailKind` `'invoice'`; subject "NFS-e nº <number> de <emitter>"; body with the summary, the link button, and the NotaFlow footer with the UTM; Reply-To is the e-mail of the member who sent it (manual) or of the account owner (automatic); rate limit 50 per hour per account.
- Automatic e-mail: emitter setting `autoEmailCustomer`; on for emitters created after the deploy, off for existing ones (migration). Only invoices the app issues (`origin = 'app'`), never sync or backfill. Address from the customer e-mail in the XML, else the customer record. No address: skip, and the detail page shows "Tomador sem e-mail na nota". The detail page shows when the e-mail went out.
- PostHog events: `danfse_link_viewed` (public page), `danfse_shared` with `channel` in `copy | native | whatsapp | mailto | notaflow_email` (app screens).
- Metric: `danfse_link_views_total`.
- Project rules: no `!`; one-line comments, only the non-obvious why; a schema change ships its migration; repositories take the account context (the public token lookup is the one system read and returns only the public fields); never delete a business row; UI strings in Portuguese; docs in Simplified Technical English, no em dash; no AI attribution; never `--no-verify`.

## Review Focus

1. **A guessed or revoked token** answers 404 with no hint, and the rate limit holds. Test in Task 2.
2. **The public summary** never leaks the customer's data, also for a CPF customer. Test in Task 2.
3. **A cancelled invoice behind an old link** shows the notice and the watermarked PDF. Test in Task 2.
4. **A member of another account** cannot create, read, or revoke a link of this account's invoice. Test in Task 2.
5. **The automatic e-mail** never fires for a synced invoice, a failed issue, or an emitter with the setting off, and fires once for a retried issue. Test in Task 5.

---

### Task 1: The links table and repository

**Files:** `apps/server/src/db/schema.ts`, `apps/server/drizzle/0023_invoice_links.sql` (generated), `apps/server/src/repos/InvoiceLinkRepository.ts` (+ test), `apps/server/src/db/migrations.test.ts`.

**Interfaces:**
```ts
// table invoice_links: id, invoice_id (fk), token (unique), views integer default 0, created_by/at, updated_*, removal columns
export class InvoiceLinkRepository {
  linkFor(ctx: AccountContext, invoiceId: string): string;          // returns the active token, creates it when missing; throws not_found for another account's invoice
  revoke(ctx: AccountContext, invoiceId: string): boolean;
  // System read: the one lookup with no account context.
  publicView(token: string): PublicInvoiceView | null;              // null for unknown, revoked, or soft-deleted invoice/emitter/account
  countView(token: string): void;
}
export interface PublicInvoiceView { invoiceId: string; accessKey: string; emitterName: string; number: string | null; issuedAt: Date | null; netCents: number; status: string; eventCodes: string[]; environment: 'producao' | 'producao_restrita' }
```

- [ ] Failing tests: create once then same token; another account gets not_found; revoke then publicView null and a new linkFor gives a new token; soft-deleted invoice/emitter/account -> null; suspended account -> view; view has no customer field (type and value).
- [ ] Implement (token with `randomBytes(32).toString('base64url')`), migration, the delete trigger rule of DATA.md.
- [ ] `pnpm vitest run apps/server` → PASS. Commit `feat(server): add invoice links`.

### Task 2: The public API and the member link routes

**Files:** `apps/server/src/routes/invoiceLinks.ts` (+ test), `apps/server/src/danfse/danfsePdf.ts` (the R2-or-draw function moved out of `routes/invoices.ts`, used by both routes), `apps/server/src/routes/invoices.ts`, `apps/server/src/app.ts`, `apps/server/src/metrics/metrics.ts`, `apps/server/src/web.ts` (robots.txt).

**Interfaces:**
- `POST /api/accounts/:accountId/invoices/:invoiceId/link` → `{ url }` (member of the account; only issued or cancelled invoices with an access key).
- `DELETE /api/accounts/:accountId/invoices/:invoiceId/link` → 204 / 404.
- `GET /api/public/n/:token` → `{ emitterName, number, issuedAt, netCents, notice: 'cancelada' | 'substituida' | null, testEnvironment }`, header `x-robots-tag: noindex`, counts a view (repository and metric).
- `GET /api/public/n/:token/pdf` → the PDF (same headers as the member download).

- [ ] Failing tests: the five Review Focus items above; the PDF route serves R2 when ready and draws otherwise (reuse the Plan B test helpers); 61st request in a minute from one IP answers 429; robots.txt disallows `/n/`.
- [ ] Implement. Commit `feat(server): serve DANFSe public links`.

### Task 3: The public link page

**Files:** `apps/web/n.html`, `apps/web/src/site/linkPage.ts` (+ test), `apps/web/vite.config.ts` (new input), `apps/server/src/web.ts` (serve `n.html` for `GET /n/:token`).

- [ ] Failing tests (jsdom, stub fetch): renders emitter, number, date, amount in pt-BR; the notice for a cancelled invoice; "SEM VALIDADE JURÍDICA" badge for a test invoice; the "Baixar PDF" link points to `/api/public/n/<token>/pdf`; the NotaFlow block links to the UTM URL; a 404 shows "Link inválido ou removido"; `danfse_link_viewed` is captured once.
- [ ] Implement in the style of the guide pages (Malphas tokens, `<meta name="robots" content="noindex">`, mobile first). The QR code of the call to action is generated in the page (reuse the `qrcode` package already in the repo if it bundles for the browser; otherwise a static SVG of the fixed URL built at build time).
- [ ] Commit `feat(web): add the DANFSe public link page`.

### Task 4: "Copiar link" and "Compartilhar" on the screens

**Files:** `apps/web/src/components/ShareInvoice.tsx` (+ test), `apps/web/src/pages/InvoicesPage.tsx`, `apps/web/src/pages/InvoiceDetailPage.tsx`, `apps/web/src/api.ts`.

- [ ] Failing tests: "Copiar link" calls the link API once and writes the URL to the clipboard (later clicks reuse it without a second request); "Compartilhar" uses `navigator.share` when present, else opens the menu with WhatsApp, "E-mail pelo seu app", and "Enviar por e-mail (NotaFlow)"; each channel captures `danfse_shared` with its channel; the buttons show only for issued or cancelled invoices.
- [ ] Implement with the Malphas components the pages use. The NotaFlow e-mail option opens the dialog of Task 5 (a stub until then is not allowed: do Task 5's dialog in Task 5 and wire it there).
- [ ] Commit `feat(web): copy and share the DANFSe link`.

### Task 5: The NotaFlow e-mail, by hand and after each issue

**Files:** `apps/server/src/mail/mailer.ts` (`MailKind` `'invoice'`), `apps/server/src/mail/templates.ts` (`invoiceEmail`) (+ test), `apps/server/src/routes/invoiceLinks.ts` (`POST .../invoices/:invoiceId/email` `{ to }`), `apps/server/src/issue/IssueService.ts` (after a successful issue), `apps/server/src/db/schema.ts` + migration (`emitters.auto_email_customer`, `invoices.customer_emailed_at`), the emitter settings screen, `apps/web/src/components/SendInvoiceEmail.tsx` (+ test), `InvoiceDetailPage.tsx` (sent status), the issue form (the note next to "Emitir").

- [ ] Failing tests: template has the summary, the link, the UTM footer, no customer document; manual send queues one outbox row with Reply-To the member's e-mail and the address typed (prefilled from the XML, else the customer record); 51st send in an hour answers 429; automatic send after an app issue when the setting is on and an address exists; none for a synced invoice, a rejected issue, or the setting off; one e-mail for a retried issue (idempotent through `customer_emailed_at`); migration sets the setting off for existing emitters and on by default for new ones; the detail page shows the sent time or "Tomador sem e-mail na nota"; the issue form shows "O tomador vai receber por e-mail" with a link to the setting.
- [ ] Implement. Wire the "Enviar por e-mail (NotaFlow)" option of Task 4 to the dialog.
- [ ] Commit `feat: e-mail the DANFSe link to the customer`.

### Task 6: Docs

- [ ] Update `RFC_DANFSE_PDF.md` (Plan C implemented; any decision taken in the tasks), `apps/server/AGENTS.md`, the C4 server components diagram (public link routes) with its PNG.
- [ ] `pnpm lint && pnpm typecheck && pnpm test`. Commit `docs(danfse): record plan C`.
