import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

export type Module = 'auth' | 'issue' | 'sync' | 'onboarding' | 'mail' | 'admin' | 'app' | 'web';

// The module of a route pattern, such as /api/accounts/:accountId/invoices/new: the label of every metric and log line.
export function moduleOf(route: string): Module {
  if (!route.startsWith('/api/')) return 'web';
  if (route.startsWith('/api/auth/') || route === '/api/me' || route.startsWith('/api/me/')) {
    return 'auth';
  }
  if (route.startsWith('/api/admin/')) return 'admin';
  if (route.includes('/onboarding')) return 'onboarding';
  if (/\/invoices\/(new|issue|:invoiceId\/(cancel|reconcile))$/.test(route)) return 'issue';
  if (route.endsWith('/sync')) return 'sync';
  return 'app';
}

export interface MetricSources {
  outboxCounts(): { status: string; count: number }[];
  certificateExpiries(): { emitterId: string; validTo: Date }[];
  latestLocalBackup(): Date | null;
}

export class Metrics {
  readonly registry = new Registry();
  private readonly httpRequests: Counter<'module' | 'method' | 'status'>;
  private readonly httpDuration: Histogram<'module'>;
  private readonly invoicesIssued: Counter<'result'>;
  private readonly invoicesCancelled: Counter<'result'>;
  private readonly syncRuns: Counter<'result'>;
  private readonly syncLastSuccess: Gauge<'emitter'>;

  constructor(sources: MetricSources) {
    const registers = [this.registry];
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests by module, method, and status',
      labelNames: ['module', 'method', 'status'],
      registers,
    });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration by module',
      labelNames: ['module'],
      buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers,
    });
    this.invoicesIssued = new Counter({
      name: 'invoices_issued_total',
      help: 'Issue attempts by result: issued, rejected, uncertain',
      labelNames: ['result'],
      registers,
    });
    this.invoicesCancelled = new Counter({
      name: 'invoices_cancelled_total',
      help: 'Cancel attempts by result',
      labelNames: ['result'],
      registers,
    });
    this.syncRuns = new Counter({
      name: 'sync_runs_total',
      help: 'ADN sync runs by result: ok, error',
      labelNames: ['result'],
      registers,
    });
    this.syncLastSuccess = new Gauge({
      name: 'sync_last_success_timestamp_seconds',
      help: 'Unix time of the last successful sync, by internal emitter id',
      labelNames: ['emitter'],
      registers,
    });
    new Gauge({
      name: 'mail_outbox_messages',
      help: 'Mail outbox rows by status: pending, sending, failed (dead letters), sent',
      labelNames: ['status'],
      registers,
      collect() {
        this.reset();
        for (const status of ['pending', 'sending', 'failed', 'sent']) this.set({ status }, 0);
        for (const row of sources.outboxCounts()) this.set({ status: row.status }, row.count);
      },
    });
    new Gauge({
      name: 'certificate_expiry_timestamp_seconds',
      help: 'Unix time when the active certificate expires, by internal emitter id',
      labelNames: ['emitter'],
      registers,
      collect() {
        this.reset();
        for (const row of sources.certificateExpiries()) {
          this.set({ emitter: row.emitterId }, Math.floor(row.validTo.getTime() / 1000));
        }
      },
    });
    new Gauge({
      name: 'backup_last_timestamp_seconds',
      help: 'Unix time of the newest local backup file',
      labelNames: ['kind'],
      registers,
      collect() {
        this.reset();
        const at = sources.latestLocalBackup();
        if (at) this.set({ kind: 'local' }, Math.floor(at.getTime() / 1000));
      },
    });
  }

  request(module: Module, method: string, status: number, seconds: number): void {
    this.httpRequests.inc({ module, method, status: String(status) });
    this.httpDuration.observe({ module }, seconds);
  }

  invoice(result: string): void {
    this.invoicesIssued.inc({ result });
  }

  cancel(result: string): void {
    this.invoicesCancelled.inc({ result });
  }

  syncRun(emitterId: string, error: string | null | undefined, at: Date): void {
    this.syncRuns.inc({ result: error ? 'error' : 'ok' });
    if (!error) this.syncLastSuccess.set({ emitter: emitterId }, Math.floor(at.getTime() / 1000));
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
