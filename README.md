# NotaFlow

NotaFlow issues, copies, and cancels Brazilian service invoices (NFS-e) through the national system. It is live at **[notaflow.vapulab.com](https://notaflow.vapulab.com)**.

Its main feature: open an invoice that you already issued, and issue a new one with the same fields. You change only what is different, usually the competence date, the amounts, or the customer.

## What NotaFlow does

- **Copy an invoice.** Pick an issued invoice as the template. NotaFlow copies every fiscal group (ISS, PIS/COFINS, Simples, IBS/CBS, foreign trade) and refuses a template that it cannot copy in full.
- **Issue a new invoice.** Start from a blank form, with a customer from your register.
- **Cancel an invoice** through the national system.
- **Sync your history.** NotaFlow reads every invoice and event of your company from the national system (ADN) every 30 minutes, also the invoices that you issued before NotaFlow.
- **Never issue twice.** Each issue reserves a DPS number first, and a timeout is checked against the national system before a retry.
- **Many companies, many people.** One account holds one or more issuing companies (CNPJ) and invites members.

## How to start

1. Go to [notaflow.vapulab.com](https://notaflow.vapulab.com) and sign up with your e-mail.
2. Name your account and send the company CNPJ card (PDF), or type the CNPJ.
3. Send the company A1 certificate (`.pfx`) and its password. The certificate CNPJ must be the card CNPJ. The server keeps it encrypted.
4. Check the fiscal configuration.
5. Wait for the first sync. Your invoices show on the dashboard, and you can copy one.

## For developers

You need Node 22 or later and pnpm 10.

```sh
pnpm install
pnpm fake:nacional   # fake national system on port 4010
pnpm dev:server      # needs apps/server/.env.local, see apps/server/.env.example
pnpm dev:web         # Vite dev server, proxies /api to the server
```

Before a PR, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. PRs go to the `production` branch, and a merge deploys to production.

Start at [AGENTS.md](AGENTS.md) for the project rules and the package map. Then read:

- [Architecture Overview](docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md), with the C4 diagrams
- [Design RFC](docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md)
- [All docs](docs/README.md)

## License

[Business Source License 1.1](LICENSE).
