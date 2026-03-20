# 0006 — Branching Hotspots Audit (Q3)

Status: `active`
Scope: Phase B (`B1`–`B4`)

## Objective

Identify remaining non-machine policy branching in `packages/sync`, `services/cron`, and `services/worker`, then remove a high-risk hotspot by routing retry/terminal decisioning through machine transitions.

## Hotspot Inventory

### `packages/sync` (B1)

- `packages/sync/src/sync-user.ts`
  - Catch-path policy branching used to classify runtime errors and choose retry vs terminal behavior.
  - Retry/terminal classification and dispatch shape were inlined in orchestration flow.

### `services/cron` (B2)

- `services/cron/src/jobs/ingest-sources.ts`
  - Still contains orchestration-heavy branches (provider family branching, source shape branches).
  - Failure policy is already centralized through `classifySourceIngestionFailure`, but file still has structural branch density suitable for extraction in later slices.

### `services/worker` (B3)

- `services/worker/src/processor.ts`
  - Aggregation/error summarization branches are still local; currently low-risk but can be normalized behind table-driven helpers.
- `services/worker/src/push-job-arbitration-runtime.ts`
  - Outcome branching is concise and deterministic; keep for now.

## Implemented in Q3 (B4)

- Added `packages/sync/src/destination-execution-failure-event.ts`.
  - Central helper `mapDestinationExecutionFailureEvent(...)` maps thrown errors to machine events:
    - retryable -> `EXECUTION_FAILED`
    - terminal -> `EXECUTION_FATAL_FAILED`
  - Uses `DestinationExecutionFailureClassification` enum (no ad-hoc string flags).
- Added tests:
  - `packages/sync/src/destination-execution-failure-event.test.ts`
- Updated `packages/sync/src/sync-user.ts`:
  - Removed inlined retry/terminal classifier.
  - Dispatches mapped machine failure event through runtime.
  - Resolves final retry/disable decision from machine transition outputs via `resolveDestinationFailureOutput`.
  - Preserves terminal rethrow behavior after machine-driven failure handling.

## Validation

- `bun test packages/sync/src/destination-execution-failure-event.test.ts packages/sync/src/destination-execution-runtime.test.ts packages/sync/src/destination-failure-policy.test.ts`
- `bunx turbo run lint types --filter=./packages/sync --filter=./packages/state-machines`
- `bun test` (repo root)

