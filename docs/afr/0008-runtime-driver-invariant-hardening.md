# 0008 — Runtime Driver Invariant Hardening (C5–C8)

Status: `active`
Scope: Phase C (`C5`–`C8`)

## Objective

Harden machine runtime execution against malformed envelopes, malformed outbox records, and malformed snapshot state transitions, with deterministic fail-fast behavior.

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

## Tests Added/Updated

- `packages/machine-orchestration/src/machine-runtime-driver.test.ts`
  - fails fast on malformed envelope metadata
  - fails fast on malformed snapshot data
  - fails fast on invalid in-memory outbox index

## Validation

- `bun test packages/machine-orchestration/src/machine-runtime-driver.test.ts`
- `bunx turbo run lint types --filter=./packages/machine-orchestration --filter=./packages/sync --filter=./services/cron --filter=./services/worker`
- `bun test` (repo root)

