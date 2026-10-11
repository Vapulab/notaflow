# Deploy on the Vapulab VPS

NotaFlow runs at `https://notaflow.vapulab.com` on the Vapulab VPS at Hostinger (`ssh vapulab`, Ubuntu 24.04, Docker). A merge to `production` deploys it: CI passes, the `Deploy` workflow builds the image, pushes it to GHCR, and starts it on the VPS over SSH. This page is how to run, check, roll back, and restore it.

Deploys run one at a time, and only the commit at the tip of `production` goes live: when two merges come close together and the older one's CI finishes last, its deploy is skipped with a notice, because the newer run deploys the newer commit.

## Layout on the VPS

| Path | What |
| --- | --- |
| `/opt/notaflow/compose.yaml` | Copied by the workflow from `deploy/compose.yaml` |
| `/opt/notaflow/.env` | Secrets and settings, mode 600 (see `deploy/.env.example`). `IMAGE=` is written by the workflow |
| Docker volume `notaflow_data` | `/data` in the container: `notaflow.db` and `backups/` |
| `/opt/northub/cloudflared/config.yml` | The tunnel ingress, shared with northub and Vapulab. NotaFlow is `notaflow.vapulab.com → http://notaflow:3000` |
| `/etc/systemd/system/notaflow-backup.{service,timer}` | Daily backup at 03:00 (America/Sao_Paulo) |

The app publishes no host port. The northub tunnel reaches it on the Docker network `northub_default`, with the alias `notaflow`. The DNS record `notaflow.vapulab.com` is a proxied CNAME to the tunnel.

## Secrets

| Secret | Where | Note |
| --- | --- | --- |
| `NFSE_MASTER_KEY` | `/opt/notaflow/.env` | Generated on the VPS. Keep a copy in the password manager, never next to a backup. Without it, stored certificates cannot be opened: users upload the `.pfx` again |
| `BETTER_AUTH_SECRET` | `/opt/notaflow/.env` | Signs the session cookies. Changing it logs everyone out |
| `RESEND_API_KEY` | `/opt/notaflow/.env` | Sends the login codes from `nao-responda@notaflow.vapulab.com` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `/opt/notaflow/.env` | Google Cloud project `NotaFlow`, client `NotaFlow web` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | `/opt/notaflow/.env` | The Turnstile widget of `notaflow.vapulab.com` |
| `POSTHOG_TOKEN`, `POSTHOG_HOST` | `/opt/notaflow/.env` | The PostHog project key (public by design) and host; the host defaults to `https://us.i.posthog.com`. Without the key, the app sends no analytics |
| `VM_SSH_KEY`, `VM_KNOWN_HOSTS`, `VM_HOST` | Secrets of the GitHub environment `production`, which only the `production` branch can use | The deploy key (`notaflow-deploy` in `/root/.ssh/authorized_keys`, with `restrict`: no forwarding, no terminal) |

To see the master key for the password manager: `ssh vapulab "grep NFSE_MASTER_KEY /opt/notaflow/.env"` in your own terminal.

## Everyday commands

Run them on the VPS, in `/opt/notaflow`:

```bash
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
```

Create or promote a platform admin:

```bash
docker compose exec app node --import tsx apps/server/src/seed.ts <email> "<name>"
```

## Roll back

A red health check in the `Deploy` run means production is down: compose already replaced the container, and `.env` holds the new `IMAGE`. Roll back right away, as below, with the tag of the last good run.

Every image is tagged with its commit. Put the older tag in `.env` and start it:

```bash
sed -i '/^IMAGE=/d' .env && echo IMAGE=ghcr.io/darkanum/notaflow:<older sha> >> .env
docker compose up -d
```

A migration that already ran stays in the database; an older image works only if the schema change was additive (every migration so far is).

## Backups and restore

`notaflow-backup.timer` runs `backup.ts` in the container every day at 03:00. It writes a consistent copy (SQLite online backup) to `/data/backups/notaflow-<UTC time>.db` and keeps the newest 14. Run one now with `systemctl start notaflow-backup.service`.

Restore:

```bash
cd /opt/notaflow
docker compose stop app
docker run --rm -v notaflow_data:/data alpine sh -c 'cp /data/backups/<file>.db /data/notaflow.db && rm -f /data/notaflow.db-wal /data/notaflow.db-shm'
docker compose start app
```

The backups live on the same disk as the database. After a VPS loss, the ADN is the backup for invoices: deploy again, onboard the emitter with its `.pfx`, and sync. What exists only in the database (accounts, users, manual customer data, the audit log, DPS numbering) needs a backup copied off the VPS; that is planned after Stage 1.

## Login

The app has its own login (Better Auth, stage 3b): e-mail code, Google, password, and passkey. The codes come from `nao-responda@notaflow.vapulab.com` through Resend. `SIGNUP_OPEN=false` keeps signup closed until onboarding ships: existing users log in, and a platform admin links new users as before.

Cloudflare Access protected the hostname until the stage 3b cut-over. After it, the hostname is public; the tunnel, the WAF, and Turnstile stay.

## The tunnel

The tunnel is shared. Before an edit, copy `config.yml` with a date suffix; after `docker compose restart tunnel` in `/opt/northub`, check that `https://vapulab.com`, `https://northub.tech`, and `https://notaflow.vapulab.com/api/health` still answer.
