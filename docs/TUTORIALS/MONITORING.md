# Monitoring

The monitoring stack runs on the VPS in `/opt/monitoring`. Its files are in [deploy/monitoring](../../deploy/monitoring). It collects metrics and logs, sends alerts to the team channel, and shows four Grafana panels at [grafana.vapulab.com](https://grafana.vapulab.com). The design is in the [Monitoring RFC](../ENGINEERING/RFCS/2026/10/RFC_MONITORING.md).

## Open the panels

1. Go to `https://grafana.vapulab.com`.
2. Cloudflare Access asks for your e-mail and sends a PIN. Only `lincoln.giacomini@gmail.com` is allowed.
3. Log in to Grafana as `lincoln`. The password is `GF_SECURITY_ADMIN_PASSWORD` in `/opt/monitoring/.env` on the VPS. Read it with `ssh vapulab "grep GF_SECURITY_ADMIN_PASSWORD /opt/monitoring/.env"`.
4. Open the folder **NotaFlow and VPS**.

| Panel | Use it to |
| --- | --- |
| 1. Overview | See if each site and the host are up, the uptime, and the alerts that are firing now. |
| 2. NotaFlow by module | See the requests, the 5xx rate, the p95 latency, and the warnings of each module. The **Business** row has the invoices, sync, mail outbox, certificates, and backups. |
| 3. VPS and containers | See the CPU, memory, disk, and network of the host and of each container. |
| 4. Logs | Search the logs. Filter by container and by NotaFlow module, and type a text in **Search**. |

The panels come from the files in `deploy/monitoring/grafana/dashboards`. A change made in the Grafana UI is not saved. To change a panel, edit its JSON file and install it again (see below).

## Alerts

The rules are in `deploy/monitoring/prometheus/rules.yml`, and CI tests them with `promtool test rules`. Alertmanager sends a firing alert to the channel, sends it again every 4 hours while it is open, and sends a message when it is resolved.

| Alert | What to do |
| --- | --- |
| SiteDown | Open the site. Check `docker ps` on the VPS and the tunnel logs (`docker logs northub-tunnel-1`). |
| ApiErrors, ApiSlow | Open panel 2 for the module, then its errors in Sentry and in panel 4. |
| InvoicesFailing | Look at the invoice in the app. An `uncertain` result needs a reconcile. |
| SyncStale | Look at the sync errors of the emitter in panel 4 (module `sync`). |
| DeadLetters | Retry the e-mails in `/admin`. |
| CertificateExpiring | Ask the company for a new A1 certificate. |
| BackupStale, BackupMissing | Run `systemctl status notaflow-backup.service notaflow-offsite-backup.service` on the VPS. |
| DiskFilling | Run `docker system df` and remove old images with `docker image prune`. |
| ContainerRestarting | Read the logs of the container in panel 4. |
| MonitoringTargetDown | Run `docker compose ps` in `/opt/monitoring`. |

### The outside check

The alert `Watchdog` is always firing on purpose, and the panels hide it. Alertmanager sends it every minute to the Healthchecks.io check `vps-watchdog`, at the ping URL in `/opt/monitoring/secrets/healthchecks_url`. When the pings stop for 5 minutes, Healthchecks.io posts to the Discord channel. Then the VPS, Prometheus, Alertmanager, or their network is down: start with `ssh vapulab`.

### Silence an alert

To stop the messages of a known problem while you fix it:

1. In Grafana, go to **Alerting**, **Silences**, and select the **Alertmanager** data source.
2. Click **New silence**, add the matcher `alertname=<name>`, and set a duration.
3. Write the reason in the comment, then save.

## The alert channel

Alertmanager reads the webhook URL from `/opt/monitoring/secrets/alert_webhook_url`. The file is not in git.

1. Create the webhook in the Discord channel (**Edit channel**, **Integrations**, **Webhooks**).
2. On the VPS, write the URL to the file without printing it:
   `ssh vapulab "cat > /opt/monitoring/secrets/alert_webhook_url"`, paste the URL, then press Enter and Ctrl+D.
3. Run `cd /opt/monitoring && docker compose restart alertmanager`.

For Slack, change `discord_configs` and `webhook_url_file` in `alertmanager.yml` to `slack_configs` and `api_url_file`.

## Install or update the stack

The deploy workflow does not touch `/opt/monitoring`. A change to `deploy/monitoring` is installed by hand after its PR is merged:

1. Copy the folder: `scp -r deploy/monitoring/* vapulab:/opt/monitoring/`.
2. On the VPS, run `cd /opt/monitoring && chown -R root:root . && docker compose up -d`.
3. For a change in `prometheus/` or `alertmanager/` only, `docker compose restart prometheus alertmanager` is enough.

The first install also needs the following:

1. `/opt/monitoring/.env` (mode 600) with `GF_SECURITY_ADMIN_USER` and a random `GF_SECURITY_ADMIN_PASSWORD`.
2. The files `/opt/monitoring/secrets/alert_webhook_url` (the Discord webhook) and `/opt/monitoring/secrets/healthchecks_url` (the Healthchecks.io ping URL), each owned by `65534` with mode 400, in a folder with mode 700.
3. The folder `/var/lib/node_exporter/textfile` with mode 755, where the off-site backup writes its last success. node-exporter runs as `nobody` and must read it.
4. The stack must be running before the NotaFlow app starts, because the app joins its `monitoring` network.
5. The tunnel rule `grafana.vapulab.com -> http://grafana:3000` in `/opt/northub/cloudflared/config.yml`, the proxied CNAME to the tunnel, and the Cloudflare Access application **Grafana (monitoring)**.

## Errors in Sentry

The server and the browser send their errors to the Sentry projects `notaflow-server` and `notaflow-web` when `SENTRY_DSN_SERVER` and `SENTRY_DSN_WEB` are set in `/opt/notaflow/.env`. Each event has a `module` tag and the release (the image tag). Before an event leaves, it loses e-mails, CPFs, CNPJs, cookies, headers, and query strings.
