# DANFSe Worker: AI Context

Draws queued DANFSe PDFs and stores them in R2. It runs in its own container from the server image and has no database access.

## Quick Reference

- Entry: `src/main.ts` (`pnpm dev:worker`, needs `apps/danfse-worker/.env.local`); job logic: `src/process.ts`; config: `src/config.ts`
- Queue `danfse`, concurrency 2. It reads `job.data` only, never the BullMQ job id.
- Output: `danfse/<accessKey>-<mark>.pdf` in R2, built with `danfseKey` from `@notaflow/danfse-pdf`. The job returns `{ renderMs, bytes }`; the server reads that shape.
- Env: `REDIS_URL`, `R2_ACCOUNT_ID`, `R2_DANFSE_ACCESS_KEY_ID`, `R2_DANFSE_SECRET_ACCESS_KEY`, `R2_DANFSE_BUCKET`. All are required.
- Depends on: `@notaflow/danfse-pdf`, `@notaflow/r2`, `bullmq`, `ioredis`.

## Key Rules

1. A bad XML throws, so BullMQ retries. A malformed payload throws `UnrecoverableError`.
2. `DanfseJob` here copies the server type; a test keeps the field names equal.
3. Never log the job payload: it holds the customer CPF.
4. `bullmq` and `ioredis` stay on the same exact versions as the server.
