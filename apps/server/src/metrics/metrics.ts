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
  accountCounts(): { status: string; count: number }[];
  userCount(): number;
  emitterCounts(): { environment: string; count: number }[];
  invoiceCounts(): { origin: string; status: string; environment: string; count: number }[];
  lifecycleCounts(): { phase: string; step: number; count: number }[];
  bugReportCounts(): { status: string; count: number }[];
  bugDeliveryCounts(): { channel: string; state: string; count: number }[];
  bugImageCounts(): { state: string; count: number }[];
  danfsePendingOldest(): Date | null;
}

const QUEUE_CACHE_MS = 30_000;

export class Metrics {
  readonly registry = new Registry();
  private readonly httpRequests: Counter<'module' | 'method' | 'status'>;
  private readonly httpDuration: Histogram<'module'>;
  private readonly invoicesIssued: Counter<'result'>;
  private readonly invoicesCancelled: Counter<'result'>;
  private readonly danfseOnDemandTotal: Counter;
  private readonly danfseJobs: Counter<'result'>;
  private readonly danfseRenderSeconds: Histogram;
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
    this.danfseOnDemandTotal = new Counter({
      name: 'danfse_on_demand_total',
      help: 'DANFSe downloads drawn on demand, not served from R2',
      registers,
    });
    this.danfseJobs = new Counter({
      name: 'danfse_jobs_total',
      help: 'DANFSe queue jobs by result: completed, failed (after the last attempt)',
      labelNames: ['result'],
      registers,
    });
    this.danfseRenderSeconds = new Histogram({
      name: 'danfse_render_seconds',
      help: 'Time the worker took to draw one DANFSe PDF',
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers,
    });
    new Gauge({
      name: 'danfse_pending_oldest_seconds',
      help: 'Age of the oldest invoice still waiting for its DANFSe PDF, 0 when none waits',
      registers,
      collect() {
        const since = sources.danfsePendingOldest();
        this.set(since ? Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000)) : 0);
      },
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
    // The business totals, read from the database at scrape time: counts only, never a name or document.
    new Gauge({
      name: 'notaflow_accounts',
      help: 'Accounts by status',
      labelNames: ['status'],
      registers,
      collect() {
        this.reset();
        for (const status of ['active', 'suspended']) this.set({ status }, 0);
        for (const row of sources.accountCounts()) this.set({ status: row.status }, row.count);
      },
    });
    new Gauge({
      name: 'notaflow_users',
      help: 'Users with a login, invited members included',
      registers,
      collect() {
        this.set(sources.userCount());
      },
    });
    new Gauge({
      name: 'notaflow_emitters',
      help: 'Emitters (companies with a certificate) by environment',
      labelNames: ['environment'],
      registers,
      collect() {
        this.reset();
        for (const environment of ['producao', 'producao_restrita']) this.set({ environment }, 0);
        for (const row of sources.emitterCounts()) {
          this.set({ environment: row.environment }, row.count);
        }
      },
    });
    new Gauge({
      name: 'notaflow_invoices',
      help: 'Invoices by origin (app: issued by NotaFlow; synced: imported), status, and environment',
      labelNames: ['origin', 'status', 'environment'],
      registers,
      collect() {
        this.reset();
        for (const row of sources.invoiceCounts()) {
          this.set(
            { origin: row.origin, status: row.status, environment: row.environment },
            row.count,
          );
        }
      },
    });
    new Gauge({
      name: 'notaflow_lifecycle_emails',
      help: 'Lifecycle reminders sent, by phase and step',
      labelNames: ['phase', 'step'],
      registers,
      collect() {
        this.reset();
        for (const row of sources.lifecycleCounts()) {
          this.set({ phase: row.phase, step: String(row.step) }, row.count);
        }
      },
    });
    new Gauge({
      name: 'notaflow_bug_reports',
      help: 'Bug reports by status: open (active), closed (resolved)',
      labelNames: ['status'],
      registers,
      collect() {
        this.reset();
        for (const status of ['open', 'closed']) this.set({ status }, 0);
        for (const row of sources.bugReportCounts()) this.set({ status: row.status }, row.count);
      },
    });
    new Gauge({
      name: 'notaflow_bug_report_deliveries',
      help: 'Bug report deliveries not sent, by channel (github, discord, notion) and state (pending, failed)',
      labelNames: ['channel', 'state'],
      registers,
      collect() {
        this.reset();
        for (const channel of ['github', 'discord', 'notion']) {
          for (const state of ['pending', 'failed']) this.set({ channel, state }, 0);
        }
        for (const row of sources.bugDeliveryCounts()) {
          this.set({ channel: row.channel, state: row.state }, row.count);
        }
      },
    });
    new Gauge({
      name: 'notaflow_bug_report_images',
      help: 'Bug report screenshots by state: stored (in R2), purged (deleted 30 days after the report closed)',
      labelNames: ['state'],
      registers,
      collect() {
        this.reset();
        for (const state of ['stored', 'purged']) this.set({ state }, 0);
        for (const row of sources.bugImageCounts()) this.set({ state: row.state }, row.count);
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

  danfseOnDemand(): void {
    this.danfseOnDemandTotal.inc();
  }

  danfseJob(result: 'completed' | 'failed'): void {
    this.danfseJobs.inc({ result });
  }

  danfseRender(seconds: number): void {
    this.danfseRenderSeconds.observe(seconds);
  }

  // Exports the queue gauges from a cache that a scrape never waits for; call it only when a queue exists.
  watchDanfseQueue(queue: { counts(): Promise<{ failed: number; workers: number }> }): void {
    const cache: { failed: number | null; workers: number | null; at: number } = {
      failed: null,
      workers: null,
      at: Number.NEGATIVE_INFINITY,
    };
    const refresh = () => {
      if (Date.now() - cache.at < QUEUE_CACHE_MS) return;
      cache.at = Date.now();
      queue.counts().then(
        (counts) => {
          cache.failed = counts.failed;
          cache.workers = counts.workers;
        },
        // Redis down means no worker is reachable; the dead letters keep their last value.
        () => {
          cache.workers = 0;
        },
      );
    };
    const registers = [this.registry];
    new Gauge({
      name: 'danfse_dlq_size',
      help: 'DANFSe jobs that failed for good and wait for a retry in /admin',
      registers,
      collect() {
        refresh();
        if (cache.failed !== null) this.set(cache.failed);
      },
    });
    new Gauge({
      name: 'danfse_workers',
      help: 'DANFSe workers connected to the queue',
      registers,
      collect() {
        refresh();
        if (cache.workers !== null) this.set(cache.workers);
      },
    });
    refresh();
  }

  syncRun(emitterId: string, error: string | null | undefined, at: Date): void {
    this.syncRuns.inc({ result: error ? 'error' : 'ok' });
    if (!error) this.syncLastSuccess.set({ emitter: emitterId }, Math.floor(at.getTime() / 1000));
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
