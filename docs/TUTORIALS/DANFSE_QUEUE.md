# DANFSe Queue

Set up the R2 bucket, the `.env` lines, and the worker so that NotaFlow draws the DANFSe PDFs in the background. The design is in the [DANFSe PDF RFC](../ENGINEERING/RFCS/2026/10/RFC_DANFSE_PDF.md).

Without these steps, the app still works: with `REDIS_URL` unset, the queue is off and each download draws the PDF on demand.

## Before you start

- You can open the Cloudflare dashboard of the account that holds the R2 buckets.
- You can open a shell on the VPS (`ssh vapulab`).
- `R2_ACCOUNT_ID` is already in `/opt/notaflow/.env` (the backups and bug reports use it).

## Create the bucket and the token

1. In Cloudflare, go to **R2 Object Storage** and create a bucket named `notaflow-danfse`. Keep it private: do not turn on a public URL or a custom domain.
2. Go to **R2 Object Storage**, **Manage API tokens**, **Create API token**.
3. Set the permission to **Object Read & Write**. Under **Specify bucket(s)**, pick only `notaflow-danfse`.
4. Create the token. Copy the **Access Key ID** and the **Secret Access Key** now: Cloudflare shows the secret once.

## Set the environment

Add these four lines to `/opt/notaflow/.env` on the VPS:

```text
REDIS_URL=redis://redis:6379
R2_DANFSE_ACCESS_KEY_ID=<the access key ID>
R2_DANFSE_SECRET_ACCESS_KEY=<the secret access key>
R2_DANFSE_BUCKET=notaflow-danfse
```

The four values go together. The server refuses to start with only some of them.

## Deploy

Merge to `production`. The deploy workflow copies `deploy/compose.yaml` and runs `docker compose up`. It starts `redis` and `danfse-worker` next to `app`.

The migration marks every invoice that has XML as pending. After the deploy, the app sends them to the queue, 100 every 10 s. You do not run a backfill.

## Check the worker

On the VPS, in `/opt/notaflow`:

```bash
docker compose ps
docker compose logs --tail 50 danfse-worker
```

- `redis` must be `healthy`, and `danfse-worker` must be `running`.
- The worker logs one line per finished job. It never logs the job payload.
- In Grafana, panel 2 (NotaFlow by module), row **DANFSe**, shows the jobs, the render time, the dead letters, and the oldest pending PDF.

## Read the DLQ

A job that fails 5 times stays 30 days in the failed set of Redis. This set is the DLQ.

1. Log in as a platform admin and open `/admin`.
2. Find the section **PDFs não gerados**. It lists the account, the access key, the last error, and when the job failed.
3. Click **Gerar de novo** on a row. The row goes back to pending, and the next sweep (within 10 s) adds a new job with the current XML.
4. If the row fails again, read the error in the list and the worker log, and fix the cause before you retry.

The customer is not blocked while a PDF is in the DLQ: the download draws the PDF on demand.

## Alerts

The alerts go to Discord. The rules are in `deploy/monitoring/prometheus/rules.yml`.

| Alert | Meaning | What to do |
| --- | --- | --- |
| DanfseDeadLetters | One or more PDFs failed for good. | Open `/admin`, read the errors, and retry. |
| DanfseWorkerDown | No worker is connected to the queue, or Redis is down. | Run `docker compose ps` and `docker compose logs danfse-worker`, then `docker compose up -d redis danfse-worker`. |
| DanfsePendingStale | The oldest pending PDF waits too long. | Check the worker, then check that `REDIS_URL` and the R2 values are in `.env`. |

## Turn the feature off

Do not only remove the lines from `.env`. The next `docker compose up -d` (each deploy runs it) starts the worker again. Without its values, the worker exits at start, restarts in a loop, and `DanfseWorkerDown` fires.

1. Stop the worker and Redis: `docker compose stop danfse-worker redis`.
2. Remove `REDIS_URL` and the three `R2_DANFSE_*` lines from `/opt/notaflow/.env`, so the app turns the queue off and draws every PDF on demand.
3. Remove the `danfse-worker` and `redis` services from `/opt/notaflow/compose.yaml` before the next deploy copies the file back, or the deploy starts them again. To keep the feature off for good, remove them from `deploy/compose.yaml` in a PR.
