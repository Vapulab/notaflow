# R2: AI Context

Signs and sends S3 calls to Cloudflare R2 with a hand-written SigV4 client. No AWS SDK.

## Quick Reference

- Entry point: `src/index.ts`
- Client: `src/r2.ts` (`r2Client`, `signRequest`). It has `put`, `get`, and `delete`.
- Depends on: `undici`.

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - packages and ports

## Key Rules

1. Each call throws on a failed answer. `get` returns `null` for a missing object. `delete` of a missing object succeeds.
2. Tests use a mock undici dispatcher. Never call a real bucket.
