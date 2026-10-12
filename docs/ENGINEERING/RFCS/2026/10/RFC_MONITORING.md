# RFC: Monitoring, Alerts, and Error Tracking

**Status:** Accepted in design (2026-10-11); plan to follow
**Date:** 2026-10-11
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [Architecture Overview](../../../ARCHITECTURE/OVERVIEW.md) (C4 diagrams)
- [Deploy on the VM](../../../../TUTORIALS/DEPLOY_ON_VM.md) (the VPS, backups, hardening)
- Prometheus, Alertmanager, Loki, Grafana Alloy, Grafana: <https://grafana.com/docs/>
- Sentry for Node and React: <https://docs.sentry.io/platforms/javascript/>
- Healthchecks.io: <https://healthchecks.io/docs/>

## Overview

NotaFlow has no metrics, no alerts, and no error tracking today. A Resend outage or a failing sync is found by a user, not by us. This RFC adds the following:

- a monitoring stack on the VPS: metrics, logs, alerts, and Grafana panels;
- an outside dead-man's switch, which still alerts when the whole VPS is down;
- Sentry for application errors.

Every NotaFlow metric and error carries the module it belongs to. The panels show each module of NotaFlow and each service of the VPS on its own.

## Goals and Non-Goals

Goals:

- **Know first:** a failure reaches the team before it reaches a user, in a Discord or Slack channel.
- **One place to look:** a Grafana panel shows each module of NotaFlow and each service of the VPS, healthy or not.
- **Errors with context:** an error has its stack trace, release, and module, and no personal data.

Non-goals:

- Tracing across services (OpenTelemetry spans). The app is one process; logs and metrics are enough for now.
- Monitoring of the vapulab and northub app internals: they get container, uptime, and log panels only.
- Paging or on-call rotation.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Where it runs | Self-hosted on the VPS, in its own Compose project `/opt/monitoring` | The VPS has 4 CPUs, 16 GB of RAM (1 GB used), and 177 GB free. The data stays with us, and there are no plan limits. |
| Outside check | Healthchecks.io, free plan: Alertmanager pings it every minute with an always-firing Watchdog alert, and it posts to Discord after 5 minutes of silence | An inside check cannot report its own host being down. UptimeRobot was the first choice, but its free plan alerts by e-mail only. |
| Alerts | Alertmanager and Healthchecks.io post to one Discord channel | Lincoln's choice: a channel, not e-mail. |
| Errors | Sentry cloud, free plan, projects `notaflow-server` and `notaflow-web` | Errors are grouped and show the stack trace, the release, and the number of users affected. |
| Grafana access | `grafana.vapulab.com` through the existing northub tunnel, behind Cloudflare Access, with Grafana's own login | Nothing new opens on the VPS. |

## Components

| Component | Role | Retention |
| --- | --- | --- |
| Prometheus | Scrapes the app, the host, the containers, and the probes | 15 days |
| Alertmanager | Routes alerts to the webhook, groups them, and repeats an open alert every 4 hours | n/a |
| Loki | Stores the logs | 14 days |
| Grafana Alloy | Reads the logs of every container through the Docker socket (read only) and sends them to Loki, labeled by container and, for NotaFlow, by module | n/a |
| node-exporter | Host CPU, memory, disk, network | n/a |
| cAdvisor | CPU, memory, restarts per container | n/a |
| blackbox-exporter | HTTPS probes of the 3 sites and of `/api/health` from inside the VPS | n/a |
| Grafana | Panels and log search | n/a |

Only Grafana joins the `northub_default` network (for the tunnel). The other components stay on a private `monitoring` network. The NotaFlow app joins `monitoring` too, so Prometheus can scrape it.

## NotaFlow Instrumentation

**Metrics endpoint.**

- A second Fastify listener serves `GET /metrics` on port 9464.
- That port is bound inside the container and published to no host port, and the tunnel only knows port 3000, so the endpoint is never public.
- It uses `prom-client`.

**Modules.** These are the modules, and the route prefixes or code paths that map to them:

| Module | Covers |
| --- | --- |
| `auth` | `/api/auth/*`, `/api/me*` |
| `issue` | New invoice, issue similar, cancel, reconcile |
| `sync` | The ADN sync and its scheduler |
| `onboarding` | `/api/accounts/:id/onboarding/*`, card parser, CNPJ lookup |
| `mail` | The mail outbox |
| `admin` | `/api/admin/*` |
| `app` | Every other API route |

**Metrics, each with a `module` label where it applies:**

- `http_requests_total{module, method, status}` and `http_request_duration_seconds{module}`.
- `invoices_issued_total{result}`, where `result` is `issued`, `rejected`, or `uncertain`.
- `invoices_cancelled_total{result}`.
- `sync_runs_total{result}` and `sync_last_success_timestamp_seconds{emitter}`. The emitter is an internal id, not a CNPJ.
- `mail_outbox_messages{status}`, a gauge for `pending`, `failed` (the dead letters), and `sent` in the last day.
- `certificate_expiry_timestamp_seconds{emitter}`.
- `backup_last_timestamp_seconds{kind}`, where `kind` is `local` or `offsite`. The local value comes from the newest file in `/data/backups`. The off-site timer writes its last success to a textfile that node-exporter reads.

**Logs.** pino already writes JSON. Each log line of a request gets the same `module` field, so Loki can filter by module.

**Sentry.**

- The server uses `@sentry/node` and the web uses `@sentry/react`. The release is the image tag (the commit sha), and every event has a `module` tag.
- No personal data leaves: every `dataCollection` category is off (Sentry 11 replaced `sendDefaultPii`, and collects by default); `beforeSend` removes request bodies, cookies, headers, query strings, IPs, and e-mails; the user is the internal id only.
- The DSNs come from `SENTRY_DSN_SERVER` and `SENTRY_DSN_WEB`. Without them, nothing is sent.
- The CSP adds the Sentry ingest host to `connect-src`.

## Panels

1. **Overview:** a traffic light per service (NotaFlow, vapulab.com, northub.tech, tunnel, host), with uptime from the probes and the open alerts.
2. **NotaFlow by module:** one row per module, with requests, error rate, p95 latency, the module's own counters (invoices by result, sync age, mail queue and dead letters), and recent error logs.
3. **VPS and containers:** host CPU, memory, disk, and network, and each container's CPU, memory, and restarts.
4. **Logs:** a Loki search with the container and module filters ready.

The panels and data sources are provisioned from files in the repository, so a new Grafana gets them on its own.

## Alerts

| Alert | Condition | Severity |
| --- | --- | --- |
| Site down | A probe fails for 2 minutes | critical |
| API errors | 5xx above 2% of requests for 10 minutes | critical |
| Slow API | p95 above 2 s for 10 minutes | warning |
| Invoices failing | `rejected` or `uncertain` above 0 in 15 minutes | warning |
| Sync stale | No successful sync of an emitter for 2 hours | warning |
| Dead letters | `mail_outbox_messages{status="failed"}` above 0 | warning |
| Certificate expiring | An emitter's certificate expires within 30 days | warning |
| Backup stale | Local or off-site backup older than 26 hours | critical |
| Disk | Root filesystem above 80% | warning |
| Container restarting | More than 2 restarts in 15 minutes | warning |
| Monitoring down | Prometheus scrape of a target fails for 5 minutes | warning |

The Watchdog covers what the VPS cannot report itself: the VPS, Prometheus, Alertmanager, or their network is down. The probes go to the public URLs through Cloudflare, so a tunnel or edge failure is a SiteDown alert.

## Privacy and Legal

- Sentry (USA) becomes a vendor in the privacy policy. That is a new `LEGAL_VERSION`, so every user accepts again.
- Metrics and logs stay on the VPS. Loki keeps logs 14 days, which is inside the 6 months the Marco Civil requires for access logs. The audit log in the database is still the access record.

## Security

- **Grafana:** behind Cloudflare Access (e-mail one-time PIN for Lincoln) and Grafana's own admin login. Anonymous access is off, and sign-up is off.
- **Docker socket:** only Alloy and cAdvisor mount it, and only read-only.
- **Secrets:** the webhook URL, the Grafana admin password, and the Sentry DSNs live in `/opt/monitoring/.env` and `/opt/notaflow/.env` (600, root), never in git.
- **Metrics:** they carry no personal data: no e-mail, no CNPJ, no customer name. An emitter appears only by its internal id.

## Delivery Order

1. NotaFlow: the metrics endpoint, the module label, the business metrics, and the tests.
2. NotaFlow: Sentry on the server and the web, with the scrubbing tests, the CSP, and the privacy policy.
3. VPS: the monitoring Compose project, provisioning, alert rules, Grafana behind the tunnel and Access.
4. Outside: the Watchdog alert and the Healthchecks.io check, on the same Discord channel.
5. Docs: the C4 diagrams, the tutorial (how to read the panels and silence an alert), and an alert test end to end.

## Testing and Acceptance

- Unit tests for the module mapping, the metrics, and Sentry's `beforeSend` scrubbing.
- `promtool check rules` and `amtool check-config` run on the rule and Alertmanager files in CI.
- **Acceptance on the VPS:** stop a test container, and the channel gets the alert; restart it, and the channel gets the resolution. A forced error shows in Sentry with its module and no personal data. Every panel shows data.

## Open Questions

- [ ] Discord or Slack: Lincoln creates the channel and the webhook.
- [x] Sentry and Healthchecks.io accounts: Lincoln created them on 2026-10-12.
