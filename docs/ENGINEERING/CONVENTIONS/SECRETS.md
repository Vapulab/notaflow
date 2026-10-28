# Secrets

A secret never enters git. The repository is public, so a committed secret is a published secret, even after a revert.

## What is a secret here

| Secret | Where it lives |
| --- | --- |
| A tenant `.pfx` certificate and its password | In production: the encrypted vault in the database. Locally: a path outside the repo, named in `.env.local`. |
| `NFSE_MASTER_KEY` | The VM `.env` file (mode `600`), and a copy in Lincoln's password manager. Never next to a backup. |
| `TUNNEL_TOKEN` | The VM `.env` file. |
| `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`, `GITHUB_BUG_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `DISCORD_BUG_WEBHOOK_URL`, `NOTION_TOKEN`, `R2_BUG_REPORTS_ACCESS_KEY_ID`, `R2_BUG_REPORTS_SECRET_ACCESS_KEY` | The VM `.env` file. Locally, `apps/server/.env.local`. |
| A real invoice XML, or any real CNPJ, customer name, or amount | Nowhere in the repo. It is tenant data. |
| A bug report screenshot | Only in the private R2 bucket `R2_BUG_REPORTS_BUCKET`. Never in the repo, the database, GitHub, Notion, or Discord. It can show tenant data. |

## The guards

- `.gitignore` blocks `*.pfx`, `*.p12`, `*.pem`, `*.key`, `.env*` (except `.env.example`), `data/`, and spike results.
- The pre-commit hook in `.githooks/` runs `gitleaks` on staged files. `pnpm install` turns the hook on. If `gitleaks` is not installed, the commit is blocked.
- CI runs `gitleaks` on every push.
- GitHub secret scanning and push protection are on for the repository.

## Rules

1. Never pass `--no-verify` to get past the hook. Remove the value instead.
2. Tests use `@notaflow/test-kit` certificates and synthetic data with CNPJ `12345678000195`.
3. Logs never contain a certificate, a password, the master key, or a full XML. See [Logging](LOGGING.md).
4. To inspect a secret, check its length, its hash, or that it parses. Never print it.
5. If a secret reaches git or a log, rotate it first, then clean up.
