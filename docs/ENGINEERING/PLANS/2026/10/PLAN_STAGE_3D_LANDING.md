# Stage 3d: Landing and Legal Pages

**Goal:** A public landing at `/`, the terms at `/termos` and the privacy policy at `/privacidade`, and a recorded acceptance of both before anyone uses the app.

**Spec:** [RFC SaaS Signup, Stage 3d](../../../RFCS/2026/10/RFC_SAAS_SIGNUP.md#stage-3d-landing-and-legal-pages).

**Execution:** Claude alone, on 2026-10-11, while Lincoln was away. Lincoln reviews the copy and the legal texts before `SIGNUP_OPEN=true`.

## Decisions

- **Static pages.** Vite builds `landing.html`, `termos.html`, and `privacidade.html` as extra entries next to `index.html`. They have no React, only HTML, the Malphas Tailwind preset, and a small script for the theme toggle. The server sends them at `/`, `/termos`, and `/privacidade`. Every other page path still gets the SPA.
- **Acceptance gate, not only a checkbox.** A Google, passkey, or e-mail code login can create a user without the signup form. So the app, not the signup form, enforces acceptance: `GET /api/me` says whether the user accepted the current version. When not, the app shows an acceptance screen before any other screen. The signup form has the checkbox as well, and it records the acceptance right after the account exists.
- **Storage.** A new table `legal_acceptances` (user, document version, accepted at, IP, user agent). It is append-only like the audit log, and each acceptance is also audited.
- **Version.** One version string, `LEGAL_VERSION`, covers both documents. A new version asks every user again.
- **Legal review.** No Brazilian-law skill is installed. Claude drafts the texts against the LGPD, the Marco Civil da Internet, and the CDC. A fresh reviewer checks them. The PR lists the points a lawyer must confirm, and recommends installing a Brazilian-law skill.

## Tasks

1. Server: `legal_acceptances` (migration 0014), `LEGAL_VERSION`, `termsAccepted` in `GET /api/me`, `POST /api/me/legal-acceptance`, and the static routes for the three pages. Tests first.
2. Web: the acceptance gate, and the checkbox on `/cadastro`. Tests first.
3. Landing copy and page (hero, how it works, features, security, FAQ, footer), light and dark, phone and desktop.
4. Terms and privacy texts, then an independent legal review.
5. Checks: build, link check of the static pages, Playwright at phone and desktop width in both themes, the full suite. Then the PR.
