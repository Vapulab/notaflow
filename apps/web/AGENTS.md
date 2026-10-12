# Web: AI Context

The React UI, built with Vite and styled with the Malphas design system. It talks only to the server API under `/api`. See [Web UI](../../docs/ENGINEERING/ARCHITECTURE/WEB_UI.md).

## Quick Reference

- Entry: `src/main.tsx`; routes: `src/router.ts` (path routes, `navigate()`, old `#/` links redirected); API client and types: `src/api.ts`
- Login: `src/auth/authApi.ts` wraps the Better Auth client and throws `ApiError`; the pages before a session (`/entrar`, `/cadastro`, `/recuperar-senha`) render outside `MeProvider`
- Run: `pnpm dev:web` (proxies `/api` to `127.0.0.1:3000`); build: `pnpm build:web` (the server serves `apps/web/dist`)
- Tests: Vitest with jsdom (`// @vitest-environment jsdom` at the top of a component test, and `cleanup()` after each test)

## Key Rules

1. UI text is in Brazilian Portuguese; code and comments are in English.
2. Amounts arrive in cents; format them only with `formatCents`.
3. Every API error code has a message in `ERROR_TEXT` (`src/components/Layout.tsx`).
4. The environment badge is always visible where an emitter or invoice is shown.
5. Use the components in `src/ui`; never a raw color. Do not edit `src/malphas/` (copied from Malphas; see its `SOURCE.md`).
6. Both issue screens send through `useIssueSend`; never post an issue without the idempotency key and the pending-send storage.
7. Addresses use `AddressFields`; never ask the user to type an IBGE or ISO code.
8. Links are plain `<a href={routeHref(...)}>`: `useRoute` keeps internal clicks in the app. Code moves with `navigate()`, never `window.location`.
9. A screen under a new path root (not `/app`, `/admin`, `/entrar`, `/cadastro`, `/recuperar-senha`) needs that root in `APP_PATHS` in `apps/server/src/web.ts`; any other path answers the 404 page.
10. A new public page is a Vite input (`vite.config.ts`) and an entry of `STATIC_PAGES` in `apps/server/src/web.ts`, which also puts it in the sitemap. After an FAQ edit on the landing, run `pnpm seo:faq`.
