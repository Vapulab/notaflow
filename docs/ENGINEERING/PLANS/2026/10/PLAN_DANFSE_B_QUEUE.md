# DANFSe Plan B: Queue, Worker, R2, and PDF State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every invoice with XML gets its DANFSe drawn in the background by a separate worker and stored in R2; the screens show "Gerando PDF…" until it is ready, and the download serves R2 first.

**Architecture:** The repository marks an invoice `pdf_status = 'pending'` whenever its XML or its cancellation changes (an outbox, like the mail outbox). A sweep in the app reads pending rows every 10 s and adds BullMQ jobs to Redis with the XML in the payload. The `danfse-worker` container (same image, other command) draws the PDF with `@notaflow/danfse-pdf` and puts it in R2. The app listens to BullMQ events and writes `ready` or `failed`. The download serves R2 when `ready`, and draws on demand otherwise. The migration marks every existing invoice with XML as pending, so the backfill is the normal sweep.

**Tech Stack:** TypeScript, BullMQ 5 (`bullmq`), Redis 7 (`redis:7-alpine`), the existing SigV4 R2 client, drizzle + SQLite, Fastify, React, prom-client, Prometheus rules.

**Spec:** [RFC: DANFSe PDF Generation](../../RFCS/2026/10/RFC_DANFSE_PDF.md), sections Design, Queue/Retry/DLQ, Download, Screens, Data Model, Configuration, Metrics, Backfill. Plan A ([PLAN_DANFSE_A_RENDERER.md](PLAN_DANFSE_A_RENDERER.md)) is merged (#96).

## Global Constraints

- Queue name `danfse`. Job id `<invoiceId>:<mark>` (mark is `none`, `cancelada`, `substituida`). Payload `{ invoiceId, accessKey, mark, xmlGzipBase64 }`.
- Job options: `attempts: 5`, `backoff: { type: 'exponential', delay: 30_000 }`, `removeOnComplete: true`, `removeOnFail: { age: 30 * 24 * 3600 }` (30 days; the payload holds the customer's CPF).
- Worker concurrency 2. The worker has no database access.
- R2 key `danfse/<accessKey>-<mark>.pdf` (from `danfseKey` in `@notaflow/danfse-pdf`), content type `application/pdf`. Each mark has its own object, so a late job of an old mark cannot overwrite the watermarked PDF. A new render of the same mark writes over its object.
- Env names (checked against the root `.env`, no collisions): `REDIS_URL`, `R2_DANFSE_ACCESS_KEY_ID`, `R2_DANFSE_SECRET_ACCESS_KEY`, `R2_DANFSE_BUCKET`, with the existing `R2_ACCOUNT_ID`. The four DANFSe values go together. With `REDIS_URL` unset, the queue is off: no sweep, the download draws on demand (dev and tests).
- The customer never sees an error from the queue path: a Redis or R2 failure falls back to drawing on demand.
- Redis: `appendonly yes`, `maxmemory 256mb`, `maxmemory-policy noeviction`, a named volume, no published port. The VM has no swap.
- Project rules: no `!`; one-line comments, only the non-obvious why; a schema change ships its migration in the same commit; never delete a business row; scripts run on Windows and Linux; no AI attribution; never `--no-verify`. Docs in Simplified Technical English, no em dash.
- An architecture change updates the C4 `.mmd` and PNG in the same PR (containers and deployment diagrams).

## Review Focus

1. **A cancellation arrives while the `none` job is still running.** The `completed` event of the old job must not mark the row `ready`; the sweep must enqueue the `cancelada` job. Test in Task 4.
2. **Redis is down when the sweep runs or when the app boots.** The app must start, the sweep must log and keep the rows pending, and the download must still work. Test in Task 4 and Task 6.
3. **R2 answers an error or the object is missing while `pdf_status = 'ready'`.** The download draws on demand. Test in Task 6.
4. **A job fails 5 times.** The row becomes `failed`, the button still works, the DLQ alert fires, and an admin retry moves it back to `pending`. Tests in Tasks 4, 7, 8.
5. **The backfill after deploy enqueues thousands of rows.** The sweep enqueues at most 100 rows per run, so Redis memory and the worker stay bounded. Test in Task 4.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/r2/` (`@notaflow/r2`) | The SigV4 R2 client, moved from `apps/server/src/bugs/r2.ts` |
| `apps/server/src/db/schema.ts`, `apps/server/drizzle/0022_danfse_pdf_state.sql` | PDF state columns and the backfill update |
| `apps/server/src/repos/InvoiceRepository.ts` | Writers set `pending`; `pdfStatus` in list and detail |
| `apps/server/src/repos/DanfseRepository.ts` | System reads and writes for the sweep and the events (no account context, like `SyncTargetRepository`) |
| `apps/server/src/danfse/queue.ts` | `DanfseQueue` port, `bullmqQueue`, `memoryQueue` (tests) |
| `apps/server/src/danfse/DanfseDispatcher.ts` | Sweep and event handlers |
| `apps/server/src/config.ts` | `danfse` settings |
| `apps/danfse-worker/` (`@notaflow/danfse-worker`) | The worker process |
| `apps/server/src/routes/invoices.ts` | R2-first download |
| `apps/server/src/metrics/metrics.ts`, `deploy/monitoring/prometheus/rules.yml`, `rules.test.yml` | Metrics and alerts |
| `apps/server/src/routes/adminDanfse.ts`, `apps/web/src/pages/AdminPage.tsx` | DLQ list and retry |
| `apps/web/src/api.ts`, `apps/web/src/pages/InvoicesPage.tsx`, `InvoiceDetailPage.tsx`, `apps/web/src/components/PdfButton.tsx` | PDF state on the screens |
| `deploy/compose.yaml`, `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-2-containers.*`, `c4-4-deployment.*`, `docs/TUTORIALS/DANFSE_QUEUE.md` | Deployment and ops |

---

### Task 1: Move the R2 client to `@notaflow/r2`

**Files:**
- Create: `packages/r2/package.json`, `tsconfig.json`, `AGENTS.md`, `src/index.ts`
- Move (git mv): `apps/server/src/bugs/r2.ts` → `packages/r2/src/r2.ts`, `apps/server/src/bugs/r2.test.ts` → `packages/r2/src/r2.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/bugs/BugReports.ts`, `apps/server/src/config.ts` (move `R2Settings` type to the package, re-export or import it), root `AGENTS.md` package table, `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md` package table

**Interfaces:**
- Produces: `@notaflow/r2` exports `r2Client(settings: R2Settings, dispatcher?: Dispatcher): R2Client`, `signRequest`, `type R2Client` (`put`, `get`, `delete`), `type R2Settings { accountId; accessKeyId; secretAccessKey; bucket }`.

- [ ] **Step 1: Move the files and fix the imports.** The package depends on `undici`. No behavior change.
- [ ] **Step 2: Run** `pnpm vitest run packages/r2 apps/server/src/bugs && pnpm typecheck && pnpm lint`. Expected: the moved tests pass unchanged.
- [ ] **Step 3: Commit** `refactor(r2): move the R2 client to @notaflow/r2`

---

### Task 2: PDF state columns, the migration, and the writers

**Files:**
- Modify: `apps/server/src/db/schema.ts` (`invoices`), `apps/server/src/repos/InvoiceRepository.ts`
- Create: `apps/server/drizzle/0022_danfse_pdf_state.sql` (generated with `pnpm --filter @notaflow/server exec drizzle-kit generate --name danfse_pdf_state`, then the backfill `UPDATE` added by hand), `apps/server/src/repos/DanfseRepository.ts`
- Test: `apps/server/src/repos/DanfseRepository.test.ts`, `apps/server/src/repos/InvoiceRepository.test.ts`, `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // schema: invoices
  pdfStatus: text('pdf_status', { enum: ['pending', 'ready', 'failed'] }),   // null: no XML
  pdfMark: text('pdf_mark', { enum: ['none', 'cancelada', 'substituida'] }), // mark of the last enqueued job
  pdfEnqueuedAt: integer('pdf_enqueued_at', { mode: 'timestamp_ms' }),
  pdfRenderedAt: integer('pdf_rendered_at', { mode: 'timestamp_ms' }),
  // index invoices_pdf_status on (pdf_status)

  export interface DueInvoice { id: string; accessKey: string; status: string; xmlGzip: Buffer; eventCodes: string[] }
  export class DanfseRepository {
    constructor(db: Database);
    // pending rows never enqueued, or enqueued more than 10 minutes ago; oldest first
    due(now: Date, limit: number): DueInvoice[];
    markEnqueued(id: string, mark: DanfseMark, now: Date): void;
    // only when the row still waits for this mark: a newer change keeps it pending
    markRendered(id: string, mark: DanfseMark, now: Date): boolean;
    markFailed(id: string, mark: DanfseMark): boolean;
    retry(id: string): boolean;               // failed -> pending, enqueued_at null
    oldestPendingAt(): Date | null;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('an issued invoice is pending until rendered', () => { /* markIssued -> pdfStatus 'pending' */ });
test('a synced invoice with XML is pending', ...);
test('a cancellation sets the invoice back to pending', ...);   // markCancelled and recordEvent 101101
test('due returns pending rows, never-enqueued first, at most `limit`', ...);
test('due skips rows enqueued less than 10 minutes ago', ...);
test('markRendered with an old mark keeps the row pending', () => {
  // markEnqueued(id,'none'); markCancelled; markRendered(id,'none') -> false, pdfStatus 'pending'
});
test('retry moves a failed row back to pending', ...);
test('the migration marks every invoice with XML as pending', ...); // migrations.test.ts
```

- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run apps/server/src/repos apps/server/src/db`
- [ ] **Step 3: Implement.** `projectionOf` adds `pdfStatus: 'pending', pdfEnqueuedAt: null`; every write to `status: 'cancelled'` (`recordEvent`, `markCancelled`, the cancelled branch of `upsertSynced` and `promote`) adds the same. Add `pdfStatus` to the `summary` select so list and detail return it. The migration ends with `UPDATE invoices SET pdf_status = 'pending' WHERE xml_gzip IS NOT NULL;`. `due` reads `eventCodes` from `invoice_events` by access key.
- [ ] **Step 4: Run them and see them pass,** then `pnpm vitest run apps/server && pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(server): track the DANFSe PDF state of each invoice`

---

### Task 3: Configuration and the queue port

**Files:**
- Modify: `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/package.json` (add `bullmq` 5)
- Create: `apps/server/src/danfse/queue.ts`, `apps/server/src/danfse/queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // config
  danfse: { redisUrl: string; r2: R2Settings } | null;   // null when REDIS_URL is unset
  export interface DanfseJob { invoiceId: string; accessKey: string; mark: DanfseMark; xmlGzipBase64: string }
  export interface FailedJob { jobId: string; invoiceId: string; failedReason: string; failedAt: Date }
  export interface DanfseQueueEvents {
    completed(jobId: string, result: { renderMs: number; bytes: number }): void;
    failed(jobId: string, reason: string): void;   // only after the last attempt
  }
  export interface DanfseQueue {
    add(job: DanfseJob): Promise<void>;          // same jobId twice is a no-op
    failed(limit: number): Promise<FailedJob[]>;
    retry(jobId: string): Promise<void>;
    counts(): Promise<{ failed: number; workers: number }>;
    listen(events: DanfseQueueEvents): void;
    close(): Promise<void>;
  }
  export const JOB_OPTIONS: JobsOptions;          // the Global Constraints values
  export function jobId(invoiceId: string, mark: DanfseMark): string;
  export function parseJobId(id: string): { invoiceId: string; mark: DanfseMark } | null;
  export function bullmqQueue(redisUrl: string): DanfseQueue;   // enableOfflineQueue: false on the producer
  export function memoryQueue(): DanfseQueue & { jobs: DanfseJob[]; complete(id: string): void; fail(id: string, reason: string): void };
  ```

- [ ] **Step 1: Write the failing tests:** config gives `danfse: null` without `REDIS_URL`; `REDIS_URL` with only some R2 DANFSe values is a problem "REDIS_URL, R2_ACCOUNT_ID, R2_DANFSE_ACCESS_KEY_ID, R2_DANFSE_SECRET_ACCESS_KEY, and R2_DANFSE_BUCKET go together"; `REDIS_URL` must parse as a `redis:` URL; the bucket name rule as for bug reports. `jobId`/`parseJobId` round-trip; `memoryQueue` ignores a duplicate job id and calls `failed` only through `fail`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `bullmqQueue` uses one `Queue` and one `QueueEvents`; `QueueEvents` `failed` fires on every attempt, so check `attemptsMade >= attempts` with `Job.fromId` before calling `events.failed`. `counts().workers` is `queue.getWorkersCount()`.
- [ ] **Step 4: Run them and see them pass.** A real-Redis test in `queue.test.ts` runs only when `process.env.TEST_REDIS_URL` is set (`describe.runIf`).
- [ ] **Step 5: Commit** `feat(server): add the DANFSe queue port and its settings`

---

### Task 4: The dispatcher: sweep and events

**Files:**
- Create: `apps/server/src/danfse/DanfseDispatcher.ts`, `apps/server/src/danfse/DanfseDispatcher.test.ts`
- Modify: `apps/server/src/app.ts` (decorate `danfse`), `apps/server/src/main.ts` (scheduler every 10 s; `queue.listen`; close on shutdown)

**Interfaces:**
- Consumes: `DanfseRepository` (Task 2), `DanfseQueue`, `jobId`, `parseJobId` (Task 3), `markFor` from `@notaflow/danfse-pdf`.
- Produces:
  ```ts
  export class DanfseDispatcher {
    constructor(deps: { repo: DanfseRepository; queue: DanfseQueue; metrics: DanfseMetrics; log: (msg: string, data?: object) => void; now?: () => Date });
    sweep(): Promise<number>;            // enqueued count; at most 100 per run
    events(): DanfseQueueEvents;         // for queue.listen
    retry(invoiceId: string): Promise<boolean>;
  }
  export interface DanfseMetrics { job(result: 'completed' | 'failed'): void; render(seconds: number): void }
  ```

- [ ] **Step 1: Write the failing tests** (with `memoryQueue` and a real in-memory database):

```ts
test('sweep enqueues a pending invoice with its mark and XML', ...);   // job.mark 'none', xml round-trips
test('sweep enqueues at most 100 rows per run', ...);                   // 150 pending -> 100 jobs
test('a completed job marks the row ready', ...);
test('a completed job for an old mark keeps the row pending, and the next sweep enqueues the new mark', ...);
test('a final failure marks the row failed and counts it', ...);
test('sweep with Redis down logs, keeps rows pending, and does not throw', ...); // queue.add rejects
test('retry moves the row to pending and retries the job', ...);
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `sweep`: `repo.due(now, 100)`, `markFor(status, eventCodes)`, `queue.add`, `repo.markEnqueued`. A failed `add` stops the run (Redis is down) and logs once. In `main.ts`, build the queue only when `config.danfse` is set; with it null, `app.danfse` is null and nothing runs.
- [ ] **Step 4: Run them and see them pass,** then `pnpm vitest run apps/server`.
- [ ] **Step 5: Commit** `feat(server): enqueue pending DANFSe renders and record their results`

---

### Task 5: The worker

**Files:**
- Create: `apps/danfse-worker/package.json` (`@notaflow/danfse-worker`, deps `bullmq`, `@notaflow/danfse-pdf`, `@notaflow/r2`), `tsconfig.json`, `AGENTS.md`, `src/process.ts`, `src/process.test.ts`, `src/config.ts`, `src/config.test.ts`, `src/main.ts`
- Modify: root `AGENTS.md` (package table and a command line `pnpm dev:worker`), root `package.json` (`"dev:worker": "tsx --env-file=apps/danfse-worker/.env.local apps/danfse-worker/src/main.ts"`)

**Interfaces:**
- Consumes: `DanfseJob`, `JOB_OPTIONS` shape (Task 3; the worker defines its own copy of the job type in `process.ts` to stay free of server code, and a test asserts the field names match the server's).
- Produces:
  ```ts
  export function processJob(job: DanfseJob, r2: R2Client, now?: () => number): Promise<{ renderMs: number; bytes: number }>;
  export function loadWorkerConfig(env: Record<string, string | undefined>): { redisUrl: string; r2: R2Settings; concurrency: 2 };
  ```

- [ ] **Step 1: Write the failing tests:** `processJob` with a fake `R2Client` puts one object at `danfse/<accessKey>.pdf` with `application/pdf` and a one-page PDF body; a bad XML throws (BullMQ retries it); `loadWorkerConfig` refuses missing values with a clear message.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `main.ts`: `new Worker('danfse', (job) => processJob(job.data, r2), { connection: { url, maxRetriesPerRequest: null }, concurrency: 2 })`, log `failed` events, close the worker on `SIGTERM` and `SIGINT`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(danfse-worker): draw queued DANFSe PDFs and store them in R2`

---

### Task 6: The download serves R2 first

**Files:**
- Modify: `apps/server/src/routes/invoices.ts` (the `danfse` route), `apps/server/src/app.ts` (an R2 client for DANFSe from `config.danfse.r2`)
- Test: `apps/server/src/routes/invoices.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
test('a ready invoice streams the PDF from R2', ...);           // fake R2 returns bytes; no render call
test('a ready invoice whose R2 object is missing is drawn on demand', ...);
test('an R2 error falls back to drawing on demand', ...);
test('a pending invoice is drawn on demand and counted', ...);  // danfse_on_demand_total + 1
test('without the queue settings the route draws on demand', ...);
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Keep the headers and the 404 rules of Plan A. Log the R2 error at `warn`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(server): serve the DANFSe from R2 when it is ready`

---

### Task 7: Metrics and alerts

**Files:**
- Modify: `apps/server/src/metrics/metrics.ts` (+ test), `apps/server/src/repos/MetricsRepository.ts` if the sources live there, `deploy/monitoring/prometheus/rules.yml`, `deploy/monitoring/prometheus/rules.test.yml`, `deploy/monitoring/grafana/dashboards/2-notaflow-modules.json` (one DANFSe row: jobs, renders, DLQ, pending age)

**Interfaces:**
- Produces: `danfse_jobs_total{result}` counter, `danfse_render_seconds` histogram, `danfse_on_demand_total` counter, `danfse_dlq_size` gauge, `danfse_workers` gauge, `danfse_pending_oldest_seconds` gauge. The two queue gauges read `queue.counts()` at most once per 30 s (cache), so a scrape never waits on Redis.

- [ ] **Step 1: Write the failing tests:** each metric appears in the registry text with the right value after the matching call; the gauges read a cached `counts()`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement,** and add the alerts with tests in `rules.test.yml`:
  - `DanfseDeadLetters`: `danfse_dlq_size > 0` for 15m, warning, module `danfse`, summary "NotaFlow: {{ $value }} DANFSe PDFs failed for good; retry them in /admin".
  - `DanfseWorkerDown`: `danfse_workers == 0` for 5m, critical.
  - `DanfsePendingStale`: `danfse_pending_oldest_seconds > 1800` for 10m, warning.
- [ ] **Step 4: Run** `pnpm vitest run apps/server/src/metrics` and the rules test the way `docs/TUTORIALS/MONITORING.md` says (promtool).
- [ ] **Step 5: Commit** `feat(monitoring): add DANFSe queue metrics and alerts`

---

### Task 8: Screens and the admin DLQ

**Files:**
- Modify: `apps/web/src/api.ts` (`pdfStatus: 'pending' | 'ready' | 'failed' | null` on `InvoiceSummary`), `apps/web/src/pages/InvoicesPage.tsx`, `apps/web/src/pages/InvoiceDetailPage.tsx`, `apps/web/src/pages/AdminPage.tsx`, `apps/web/src/test/stubApi.ts`
- Create: `apps/web/src/components/PdfButton.tsx` (+ test), `apps/server/src/routes/adminDanfse.ts` (+ test)

**Interfaces:**
- Produces: `GET /api/admin/danfse/failed` → `{ items: { invoiceId, accessKey, accountName, failedReason, failedAt }[] }`; `POST /api/admin/danfse/:invoiceId/retry` → 204. Both behind the platform-admin guard used by `adminMail.ts`. `<PdfButton status onDownload />`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('pending shows a spinner and "Gerando PDF…", and the button still downloads', ...);
test('ready and failed show "PDF"', ...);
test('the list polls every 3 s only while a visible row is pending, and stops after it is ready', ...); // fake timers
test('admin lists failed DANFSe jobs and a retry calls the API', ...);
test('the admin routes refuse a non-admin', ...);
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Use the Malphas UI components the pages already use. The spinner is CSS only and has `aria-live="polite"`. Polling refetches the current page of the list, not each row.
- [ ] **Step 4: Run them and see them pass,** then `pnpm vitest run apps/web apps/server/src/routes`.
- [ ] **Step 5: Commit** `feat(web): show the DANFSe state and add the admin DLQ`

---

### Task 9: Deployment, diagrams, and docs

**Files:**
- Modify: `deploy/compose.yaml`, `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-2-containers.mmd` and PNG, `c4-4-deployment.mmd` and PNG, `docs/ENGINEERING/RFCS/2026/10/RFC_DANFSE_PDF.md` (the outbox sweep and the migration backfill replace "enqueue after commit" and `pnpm danfse:backfill`), `apps/server/AGENTS.md`
- Create: `docs/TUTORIALS/DANFSE_QUEUE.md` (the R2 bucket and token, the `.env` lines, how to read the DLQ, how to drain it)

- [ ] **Step 1: Compose.** Add `redis` (`redis:7-alpine`, `command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]`, volume `redis`, network `danfse` only, `read_only` with a `/data` volume) and `danfse-worker` (`image: ${IMAGE}`, `command: ["node", "--import", "tsx", "apps/danfse-worker/src/main.ts"]`, `env_file: .env`, `read_only`, `tmpfs /tmp`, networks `danfse` and the default network for R2 egress). Add network `danfse` (internal) to `app`. Check the file with `docker compose -f deploy/compose.yaml config` (IMAGE=x).
- [ ] **Step 2: Diagrams.** Containers: Redis queue, DANFSe worker, R2 DANFSe bucket. Deployment: the two new containers on the VPS. Render the PNGs as the diagrams README says.
- [ ] **Step 3: Docs.** The tutorial lists the manual steps for Lincoln: create the bucket `notaflow-danfse` (private), create an R2 API token with object read and write on that bucket only, add the five lines to `/opt/notaflow/.env`, then deploy.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit** `feat(deploy): run Redis and the DANFSe worker next to the app`
