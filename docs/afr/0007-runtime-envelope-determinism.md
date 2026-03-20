# 0007 — Runtime Envelope Determinism (Q4)

Status: `active`
Scope: Phase C (`C1`–`C4`)

## Objective

Remove runtime-owned envelope fallbacks and require explicit envelope metadata (`id`, `occurredAt`, actor) on machine-runtime dispatch paths.

## C1 Audit Findings

- Runtime-owned envelope generation was present in:
  - `packages/sync/src/destination-execution-runtime.ts`
  - `packages/sync/src/credential-health-runtime.ts`
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.ts`
  - `services/worker/src/push-job-arbitration-runtime.ts`
- These paths generated envelope IDs/timestamps internally (`sequence` + `new Date().toISOString()`), making determinism and replay provenance implicit instead of explicit.

## Implemented Changes

- Added required envelope builders:
  - `DestinationExecutionRuntimeInput.createEnvelope(...)`
  - `CredentialHealthRuntimeInput.createEnvelope(...)`
  - `SourceIngestionLifecycleRuntimeInput.createEnvelope(...)`
  - `PushJobArbitrationRuntimeDependencies.createEnvelope(...)`
- Moved envelope construction responsibility to callers:
  - `packages/sync/src/sync-user.ts`
  - `packages/sync/src/resolve-provider.ts`
  - `services/cron/src/jobs/ingest-sources.ts`
  - `services/worker/src/index.ts`
- Added invariant checks in runtime dispatchers:
  - envelope `id` must be non-empty
  - envelope `occurredAt` must be parseable ISO timestamp
- Added fail-fast tests for invalid envelope metadata in:
  - `packages/sync/src/destination-execution-runtime.test.ts`
  - `packages/sync/src/credential-health-runtime.test.ts`
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts`
  - `services/worker/src/push-job-arbitration-runtime.test.ts`

## Validation

- `bun test packages/sync/src/destination-execution-runtime.test.ts packages/sync/src/credential-health-runtime.test.ts services/cron/src/lib/source-ingestion-lifecycle-runtime.test.ts services/worker/src/push-job-arbitration-runtime.test.ts`
- `bunx turbo run lint types --filter=./packages/sync --filter=./services/cron --filter=./services/worker`
- `bun test` (repo root)
