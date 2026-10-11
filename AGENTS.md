# NotaFlow: AI Router

NotaFlow is a multi-tenant web app that issues, copies, and cancels Brazilian service invoices (NFS-e) through the national system. The design is in the [RFC](docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md). The current work is the [Stage 0 plan](docs/ENGINEERING/PLANS/2026/10/PLAN_STAGE_0_SPIKE.md).

## Project-wide rules

1. Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
2. A credential never enters git. Tests use `@notaflow/test-kit` certificates and synthetic data. Never pass `--no-verify`. See [Secrets](docs/ENGINEERING/CONVENTIONS/SECRETS.md).
3. Amounts are integer cents in code. A CNPJ is a 14-character string `[0-9A-Z]`.
4. From Stage 1a, every database query goes through a repository that requires the account context.
5. Comments are a budget: one line, only the non-obvious why. See [Code Comments](docs/ENGINEERING/CONVENTIONS/CODE_COMMENTS.md).
6. Every English text follows the [Writing Style](docs/ENGINEERING/CONVENTIONS/WRITING_STYLE.md): inverted pyramid, Simplified Technical English, no em dash.
7. Commits and PRs carry no AI attribution.
8. Scripts must run on Windows and Linux. No `VAR=value cmd` prefixes.
9. Never delete a business row: use `softDelete`, and every read uses `notDeleted`. See [Data](docs/ENGINEERING/CONVENTIONS/DATA.md).

## Package entrypoints

| Package | Entrypoint |
| --- | --- |
| Core domain and ports | [packages/core/AGENTS.md](packages/core/AGENTS.md) |
| Test kit | [packages/test-kit/AGENTS.md](packages/test-kit/AGENTS.md) |
| Node signer | [packages/signer-node/AGENTS.md](packages/signer-node/AGENTS.md) |
| National provider | [packages/provider-nacional/AGENTS.md](packages/provider-nacional/AGENTS.md) |
| Fake Sefin and ADN | [packages/fake-nacional/AGENTS.md](packages/fake-nacional/AGENTS.md) |
| Server | [apps/server/AGENTS.md](apps/server/AGENTS.md) |
| Web | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| Python signer | [services/signer-py/AGENTS.md](services/signer-py/AGENTS.md) |

## Docs

[docs/README.md](docs/README.md) lists every category. Start with the [Architecture Overview](docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm lint` | ESLint on the whole repo |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm test` | Vitest on the whole repo |
| `pytest services/signer-py` | Python signer tests |
| `pnpm dev:web` | Vite dev server for the UI, proxying `/api` to the local server |
| `pnpm build:web` | Build the UI into `apps/web/dist`; the server serves it |
| `pnpm dev:server` | Local server; needs `apps/server/.env.local` and `pnpm fake:nacional`. Without `RESEND_API_KEY`, it prints login codes to its log |
| `pnpm seed:admin <email> <name>` | Create or promote a platform admin |
| `pnpm fake:nacional` | Local fake of the Sefin and the ADN on port 4010 |
| `pnpm spike:sefin` | Stage 0 spike against produção restrita (needs `.env.local`) |
| `pnpm spike:template-check` | Read-only check that every invoice in the local database can serve as a template |
