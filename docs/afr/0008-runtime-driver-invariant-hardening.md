# 0008 — Runtime Driver Invariant Hardening (C5–C10)

Status: `active`
Scope: Phase C (`C5`–`C10`)

## Objective

Harden machine runtime execution against malformed envelopes, malformed outbox records, and malformed snapshot state transitions, with deterministic typed fail-fast behavior.

## Implemented

- Added envelope invariant validation in `MachineRuntimeDriver`:
  - `id` required
  - `occurredAt` must parse as timestamp
  - `actor.id` and `actor.type` required
  - `event` must be object with `event.type` string
- Added snapshot invariant validation:
  - `snapshot.state` required
  - `snapshot.context` required
  - enforced when reading existing snapshots and writing new snapshots.
- Added outbox invariant validation:
  - `commands` must be an array
  - `nextCommandIndex` must be integer in `[0, commands.length]`
  - Redis outbox now rejects invalid JSON/non-array command payloads.
- Added typed fail-fast errors:
  - `EnvelopeInvariantError`
  - `SnapshotInvariantError`
  - `RuntimeInvariantViolationError`
- Converted remaining runtime/sync invariant throws to typed error surfaces:
  - `packages/sync/src/destination-execution-runtime.ts`
  - `packages/sync/src/credential-health-runtime.ts`
  - `services/cron/src/lib/source-ingestion-lifecycle-runtime.ts`
  - `services/worker/src/push-job-arbitration-runtime.ts`
  - `packages/sync/src/destination-failure-policy.ts`
  - `services/worker/src/processor.ts`

## Tests Added/Updated

- `packages/machine-orchestration/src/machine-runtime-driver.test.ts`
  - fails fast on malformed envelope metadata
  - fails fast on malformed snapshot data
  - fails fast on invalid in-memory outbox index
- `packages/sync/src/destination-failure-policy.test.ts`
  - asserts typed invariant error code/surface for missing/duplicated failure output
- `services/worker/src/processor.widelog-contract.test.ts`
  - asserts typed invariant error code/surface when worker job id is missing

## Validation

- `bun test packages/machine-orchestration/src/machine-runtime-driver.test.ts`
- `bun test packages/sync/src/destination-failure-policy.test.ts services/worker/src/processor.widelog-contract.test.ts`
- `bunx turbo run lint types --filter=./packages/machine-orchestration --filter=./packages/sync --filter=./services/cron --filter=./services/worker`
- `bun test` (repo root)
