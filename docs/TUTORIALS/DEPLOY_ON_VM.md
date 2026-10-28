# Deploy on the Vapulab VPS

NotaFlow runs at `https://notaflow.vapulab.com` on the Vapulab VPS at Hostinger (`ssh vapulab`, Ubuntu 24.04, Docker). A merge to `production` deploys it: CI passes, the `Deploy` workflow builds the image, pushes it to GHCR, and starts it on the VPS over SSH. This page is how to run, check, roll back, and restore it.

Deploys run one at a time, and only the commit at the tip of `production` goes live: when two merges come close together and the older one's CI finishes last, its deploy is skipped with a notice, because the newer run deploys the newer commit.

## Layout on the VPS

| Path | What |
| --- | --- |
| `/opt/notaflow/compose.yaml` | `deploy/compose.yaml` of the deployed commit, which `notaflow-deploy` downloads from GitHub |
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
| `TRUST_CLOUDFLARE_IP` | `/opt/notaflow/.env` | `true` in production: the client IP is Cloudflare's `cf-connecting-ip`, so the per-IP limits see each visitor. Elsewhere `false`, so no one can pick an IP |
| `TRUSTED_PROXY_HOST` | `/opt/notaflow/.env` | `northub-tunnel-1` in production: only the tunnel may send `cf-connecting-ip`. Unset, any private address may, so a neighbour container on `northub_default` can pick an IP |
| `METRICS_ALLOW_HOST` | `/opt/notaflow/.env` | `monitoring-prometheus-1` in production: `/metrics` answers only the Prometheus container. Use the container name, not the service name `prometheus`: another project on a shared network could have that alias. Unset, any container on a shared network can read it |
| `POSTHOG_TOKEN`, `POSTHOG_HOST` | `/opt/notaflow/.env` | The PostHog project key (public by design) and host; the host defaults to `https://us.i.posthog.com`. Without the key, the app sends no analytics |
| `SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB` | `/opt/notaflow/.env` | The DSNs of the Sentry projects `notaflow-server` and `notaflow-web`. The release is the image tag. Without a DSN, that side reports no errors. In each project, turn on "Prevent Storing of IP Addresses" |
| `GITHUB_BUG_TOKEN`, `GITHUB_BUG_REPO` | `/opt/notaflow/.env` | A fine-grained token with Issues read and write on `Vapulab/notaflow` only. It opens one issue of type Bug per report. Without it, reports skip GitHub |
| `GITHUB_WEBHOOK_SECRET` | `/opt/notaflow/.env` | The secret of the `Issues` webhook of `Vapulab/notaflow` to `https://notaflow.vapulab.com/webhooks/github` (content type `application/json`). Without it, the route answers 404 |
| `DISCORD_BUG_WEBHOOK_URL` | `/opt/notaflow/.env` | The webhook of the private Discord bugs channel. The URL is the credential: anyone with it can post |
| `NOTION_TOKEN`, `NOTION_BUGS_DATABASE_ID` | `/opt/notaflow/.env` | The Notion integration token and the id of the bugs database. Share the database with the integration |
| `R2_ACCOUNT_ID`, `R2_BUG_REPORTS_ACCESS_KEY_ID`, `R2_BUG_REPORTS_SECRET_ACCESS_KEY`, `R2_BUG_REPORTS_BUCKET` | `/opt/notaflow/.env` | The private bucket of the bug report screenshots and a token with Object Read and Write on it only. All four or none. Without them, the dialog hides the image picker. See [Bug report screenshots](#bug-report-screenshots) |
| `VM_SSH_KEY`, `VM_KNOWN_HOSTS`, `VM_HOST` | Secrets of the GitHub environment `production`, which only the `production` branch can use | The deploy key of the user `notaflow-deploy`. Its only command is `/usr/local/bin/notaflow-deploy` (`command=...,restrict`). See [Deploy user](#deploy-user) |

To see the master key for the password manager: `ssh vapulab "grep NFSE_MASTER_KEY /opt/notaflow/.env"` in your own terminal.

## Deploy user

The workflow logs in as `notaflow-deploy`, not root. The key of that user runs one program, `/usr/local/bin/notaflow-deploy` ([deploy/notaflow-deploy.sh](../../deploy/notaflow-deploy.sh)), with two actions:

- `up <commit sha>`: it checks on GitHub that the commit is the tip of `production`. Then it downloads that commit's `deploy/compose.yaml`, pulls `ghcr.io/vapulab/notaflow:<sha>` with the token from stdin, writes `IMAGE=` into `.env`, and starts the stack.
- `health`: it polls `/api/health` for 90 seconds and prints the app log on a failure.

The user is in the `docker` group, so a shell for it would be root. The forced command is the guard: a stolen key can only deploy the commit that is already the tip of `production`, never roll back to an older one. A rollback is done as root (see [Roll back](#roll-back)).

To set it up, or to rotate the key:

1. Make a key pair on your machine: `ssh-keygen -t ed25519 -N "" -C notaflow-deploy -f notaflow-deploy`.
2. Copy `deploy/notaflow-deploy.sh` and `deploy/setup-deploy-user.sh` to the VPS. Run `sh setup-deploy-user.sh "$(cat notaflow-deploy.pub)"` as root.
3. Put the private key in the `VM_SSH_KEY` secret of the `production` environment, and delete both files on your machine.
4. After the first good deploy, remove the old CI key line from `/root/.ssh/authorized_keys`.

A change to `notaflow-deploy.sh` reaches the VPS only through step 2. The deploy never updates it.

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

Every image is tagged with its commit. Images built before the repo moved to the Vapulab org are in `ghcr.io/darkanum/notaflow`. Put the older tag in `.env` and start it:

```bash
sed -i '/^IMAGE=/d' .env && echo IMAGE=ghcr.io/vapulab/notaflow:<older sha> >> .env
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

## Off-site backups

`notaflow-offsite-backup.timer` runs `/opt/notaflow/offsite-backup.sh` every day at 03:30, after the local backup. The script does four things:

1. Takes the newest file in `/data/backups`.
2. Compresses it with gzip.
3. Encrypts it with [age](https://age-encryption.org) to a public key.
4. Sends it to the Cloudflare R2 bucket `notaflow-backups`.

The bucket deletes objects older than 30 days (a lifecycle rule). The script and the units are in `deploy/`; install a new version with `install -m 700 offsite-backup.sh /opt/notaflow/`.

- **`/opt/notaflow/offsite.env`** (600, root) holds `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, and `AGE_RECIPIENT`, the public key only.
- **The R2 token** can read and write this bucket only, and only from the VPS IPv4 address. The VPS also goes out over IPv6, so the script calls `curl -4`.
- **The private key is not on the VPS.** Someone who gets into the VPS cannot read the copies. Lincoln keeps the private key in his password manager and in `keys/notaflow-backup.age.key` on his machine, which git ignores. Without it, no copy can be decrypted.

Restore from R2, on any machine with `age` and the private key:

```bash
# Download the object from the R2 dashboard (or with the same curl call the script uses, with -o).
age -d -i notaflow-backup.age.key notaflow-<UTC time>.db.gz.age | gunzip > notaflow.db
python3 -c "import sqlite3; print(sqlite3.connect('notaflow.db').execute('pragma integrity_check').fetchone())"
```

Then copy `notaflow.db` into the volume as in "Restore" above. The first copy was restored this way on 2026-10-11: the integrity check printed `ok`, with 20 tables and 16 migrations.

## Bug report screenshots

The images that a customer attaches to a bug report go to a private Cloudflare R2 bucket. The app deletes them 30 days after the GitHub issue closes. Set it up once:

1. In the Cloudflare dashboard, open **R2 Object Storage** and create the bucket `notaflow-bug-screenshots`. Keep the default location.
2. In the bucket settings, keep **Public access** off: no `r2.dev` URL and no custom domain. Only the app reads the images, with its token.
3. In **R2 Object Storage**, open **Manage API tokens** and create an account API token:
   - Permissions: **Object Read & Write**.
   - Specify bucket: `notaflow-bug-screenshots` only.
   - TTL: forever.
   - Client IP filtering: none. The app container can go out over IPv4 or IPv6, and a filter for one address family refuses the other.
4. Copy the **Access Key ID** and the **Secret Access Key**. Cloudflare shows the secret one time only.
5. Add the four variables to `/opt/notaflow/.env`:

   ```bash
   R2_ACCOUNT_ID=<the account id in the R2 overview, 32 characters>
   R2_BUG_REPORTS_ACCESS_KEY_ID=<access key id>
   R2_BUG_REPORTS_SECRET_ACCESS_KEY=<secret access key>
   R2_BUG_REPORTS_BUCKET=notaflow-bug-screenshots
   ```

6. In the bucket settings, open **Object lifecycle rules** and add a rule: prefix `bug-reports/`, delete objects 400 days after upload. This rule is only a backstop. It removes an object that no row points to, for example after a crash between the upload and the database commit, and the images of a report that never closes.
7. Run `docker compose up -d app`. Open the "Reportar bug" dialog: it now shows "Imagens (opcional)".

Do not reuse the token of the off-site backups: each token reaches one bucket only. Do not set the lifecycle rule shorter than about a year: an open report keeps its images. The app deletes them itself every hour, for reports closed more than 30 days ago. The metric `notaflow_bug_report_images{state="stored|purged"}` counts them.

## Server hardening

- **SSH:** key login only. `/etc/ssh/sshd_config.d/00-hardening.conf` turns off passwords, lets root in with a key only, turns off X11, and allows 3 tries. Delete that file and run `systemctl reload ssh` to undo it.
- **Firewall:** `ufw` denies every inbound connection but 22/tcp. The containers publish no port to the internet, and the tunnel only connects out.
- **fail2ban:** bans an IP for an hour after 5 failed SSH logins in 10 minutes (`/etc/fail2ban/jail.d/sshd.local`, reading `/var/log/auth.log`).
- **Updates:** `unattended-upgrades` installs the security updates. A new kernel still needs a reboot, which takes the three sites on this VPS down for about a minute.

## Login

The app has its own login (Better Auth, stage 3b): e-mail code, Google, password, and passkey. The codes come from `nao-responda@notaflow.vapulab.com` through Resend. `SIGNUP_OPEN=false` keeps signup closed until onboarding ships: existing users log in, and a platform admin links new users as before.

Cloudflare Access protected the hostname until the stage 3b cut-over. After it, the hostname is public; the tunnel, the WAF, and Turnstile stay.

## Lifecycle reminders

The reminders of the [Lifecycle E-mails RFC](../ENGINEERING/RFCS/2026/10/RFC_LIFECYCLE_EMAILS.md) stay off until `LIFECYCLE_START_AT` is set in `/opt/notaflow/.env`. The terms promise 15 days of notice for this change, so the release goes in this order:

1. Merge and deploy. The new terms ask every user to accept them.
2. On the same day, queue the notice e-mail to every user, with the start date 15 days later:
   `ssh vapulab "docker exec notaflow-app-1 node --import tsx apps/server/src/policyNotice.ts 2026-10-28"`
3. Add `LIFECYCLE_START_AT=2026-10-28` (the same date) to `/opt/notaflow/.env`, then run `cd /opt/notaflow && docker compose up -d`.

From that date, the service runs every 15 minutes, only Monday to Friday from 09:00 to 17:00 in Sao Paulo (holidays are not skipped). The reminders sent are in the "5. Negócio" panel. A user stops them by the link in each e-mail or in the profile.

## E-mail outbox

Every e-mail goes through the `mail_outbox` table before Resend.

- **When a send fails:** the e-mail waits and is retried after 1, 5, 30, and 120 minutes. A worker in the server checks the table every 30 seconds.
- **After the fifth failure:** the e-mail becomes `failed` (the dead letter), and the log has a line at error level with `gave up after 5 attempts`.
- **Login codes:** they are never retried after their 10 minutes.
- **What the table keeps:** the body of a sent e-mail, and of a dead code, is erased.
- **Resending by hand:** the platform admin sees the dead letters under "E-mails não entregues" in `/admin` and can resend an invite or a welcome e-mail.

To list the dead letters from the VPS:

```sh
docker exec -w /repo/apps/server notaflow-app-1 node -e "const D=require('better-sqlite3');const db=new D(process.env.DATABASE_PATH,{readonly:true});console.log(db.prepare(\"select id, kind, created_at, attempts, last_error from mail_outbox where status='failed'\").all())"
```

## The tunnel

The tunnel is shared. Before an edit, copy `config.yml` with a date suffix; after `docker compose restart tunnel` in `/opt/northub`, check that `https://vapulab.com`, `https://northub.tech`, and `https://notaflow.vapulab.com/api/health` still answer.

## Monitoring

The metrics, logs, alerts, and Grafana panels run in their own Compose project, `/opt/monitoring`. The NotaFlow app joins its `monitoring` network, so start that stack first on a new VPS. See [Monitoring](MONITORING.md).
