# Web UI

The NotaFlow web app is React and Vite, styled with Malphas, the Vapulab design system. Malphas lives in the private repo `darkanum/vapulab` (folder `malphas/`, MIT license) as Go templ components with a Tailwind 3 preset. NotaFlow is public and React, so it copies the Malphas theme and repeats the Malphas class strings in its own React components.

## Where things are

| Part | Location |
| --- | --- |
| Theme copies: tokens (light and dark colors, radius, fonts), Tailwind preset | `apps/web/src/malphas/` (see `SOURCE.md` for the source commit) |
| Font and favicon copies | `apps/web/public/malphas-assets/` |
| Tailwind and PostCSS config | `apps/web/tailwind.config.cjs`, `apps/web/postcss.config.cjs` |
| React components with the Malphas classes | `apps/web/src/ui/` (`classes.ts` holds the exact strings) |
| Page shell, navigation, environment badge, error texts | `apps/web/src/components/` |

## Rules

1. Pages use the components in `src/ui`. A page never invents a color: colors come only from the Malphas tokens (`bg-primary`, `text-fg`, `border-border`, `bg-danger/10`, ...). The test `src/ui/noRawColors.test.ts` fails on a Tailwind palette color or a hex value outside `src/malphas/`.
2. A class string in `src/ui/classes.ts` matches the `.templ` component it comes from. Change Malphas first, then copy the change here.
3. Do not edit the files in `src/malphas/`. Change them in `darkanum/vapulab`, copy them again with the commands in `SOURCE.md`, and run `pnpm malphas:check`, which compares the copies with the repo (it needs `gh` logged in to an account that can read `darkanum/vapulab`).
4. No Alpine and no `malphas.js`: React owns behavior. The Malphas Modal becomes a native `<dialog>`, which brings the focus trap, Escape, and the inert background.

## Dark mode

The tokens switch to dark colors when the OS asks for dark, unless the page sets `data-theme="light"` on `<html>`; `data-theme="dark"` forces dark. Because pages use only tokens, every screen follows.

## Screens

| Route | Screen |
| --- | --- |
| `#/` | Home: the user's accounts |
| `#/admin` | Platform admin |
| `#/a/:accountId/invoices` | Invoices, filters, lookup by access key |
| `#/a/:accountId/invoices/new` (optional `?customer=<id>`) | Nova nota: an invoice without a template, simplified mode and "Mais opções" |
| `#/a/:accountId/invoices/:invoiceId` | Invoice detail: issue similar, cancel, verify at the Sefin |
| `#/a/:accountId/invoices/:invoiceId/issue` | Issue similar: form with PTAX, review, result |
| `#/a/:accountId/emitters` | Emitters, onboarding, certificate, environment, sync |
| `#/a/:accountId/emitters/:emitterId` | Emitter: fiscal configuration (Simples annex and band, ISS rate, IBS/CBS regime) and services |
| `#/a/:accountId/customers` | Customers; "Novo cliente" in Brazil or abroad |
| `#/a/:accountId/customers/:customerId` | Customer edit by hand |
| `#/a/:accountId/members` | Members |

The issue review and the cancel dialog show the environment badge, and their confirm buttons name the environment ("Emitir em PRODUÇÃO", "Cancelar em PRODUÇÃO"). The issue form keeps one `Idempotency-Key` per review. After an answer that does not say whether the invoice exists (a network error, a 5xx, or a proxy timeout such as Cloudflare's 524), the review allows only "Tentar de novo" with the same key, and the key and the reviewed values survive a reload (`sessionStorage`). A 4xx answer is definitive: the server refused before reserving a number, so the user may edit again. So is a 502 `ptax_unavailable`.

Both issue screens share this behavior through `components/useIssueSend.ts` (key, lock, pending send, send, verify) and `components/IssueResultView.tsx` (the rejected and unconfirmed screens).

Addresses use `components/AddressFields.tsx`: the CEP fills the street, the district, and the IBGE municipality through `GET cep/:cep`; the municipality and the country are picked from the Anexo A lists, never typed as codes. The document decides the kind of address: CNPJ or CPF in Brazil, NIF or no document abroad.

`Field` pairs its label and control with `for`/`id`, so a select is named by its label alone and the hint describes the control (`aria-describedby`). Owner-only controls are disabled for a member, with the reason shown once on the page.
