# Monitoring: Implementation Plan

**Goal:** Carry out the [Monitoring RFC](../../../RFCS/2026/10/RFC_MONITORING.md).

**Execution:** Claude, inline, one PR per step. Each step is merged and checked in production before the next one starts.

## Steps

1. **Metrics (`feat/metrics`)**
   - `src/metrics/`: a per-app `prom-client` registry and `moduleOf(route)`.
   - The HTTP request counter and latency histogram, labeled by module.
   - The invoice counters, at the issue, cancel, and reconcile routes.
   - The sync counter and the last-success gauge.
   - Gauges read at scrape time: the mail outbox, certificate expiry, and backup age.
   - A metrics listener on `METRICS_PORT` (9464), with no host port.
   - A `module` field on the request logs.
   - Tests first.
2. **Sentry (`feat/sentry`)**
   - `@sentry/node` and `@sentry/react` behind `SENTRY_DSN_SERVER` and `SENTRY_DSN_WEB`.
   - Each event carries a `module` tag, and its release is the commit sha.
   - `beforeSend` scrubs the event, with a test.
   - The CSP gets the Sentry `connect-src`.
   - The privacy policy names Sentry as a vendor, and the `LEGAL_VERSION` changes.
3. **Stack (`feat/monitoring-stack`)**
   - `deploy/monitoring/` holds the Compose file and the config of Prometheus, Alertmanager, Loki, Alloy, Grafana, node-exporter, cAdvisor, and blackbox.
   - It also holds the alert rules, the provisioned dashboards, and a CI check of the rules (`promtool` and `amtool` in Docker).
   - The stack is installed on the VPS, and `grafana.vapulab.com` goes through the tunnel and Cloudflare Access.
4. **Outside check (`feat/watchdog`):** an always-firing Watchdog alert that Alertmanager sends to Healthchecks.io every minute. Healthchecks.io posts to Discord when the pings stop.
5. **Docs and acceptance**
   - The C4 diagrams and the tutorial (how to read a panel and how to silence an alert).
   - An end-to-end alert test.
