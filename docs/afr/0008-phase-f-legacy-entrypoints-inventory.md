# 0008 — Phase F Legacy Entrypoints Inventory (F1)

Status: `active`
Scope: Phase F clean-cut migration

## Reachable Legacy Entrypoints

- `services/worker/src/processor.ts`
  - Reachability: `services/worker/src/index.ts` -> `processJob(...)` -> `syncDestinationsForUser(...)`
  - Legacy concern: monolithic orchestration path in `packages/sync/src/sync-user.ts` still owns cross-machine flow control.

- `packages/sync/src/sync-user.ts`
  - Reachability: package export in `packages/sync/src/index.ts`, consumed by worker processor.
  - Legacy concern: still acts as root orchestration coordinator for destination execution + provider resolution + calendar sync loop.

- `services/api/src/utils/source-lifecycle.ts`, `services/api/src/utils/oauth-sources.ts`, `services/api/src/utils/caldav-sources.ts`
  - Reachability: API source routes create/update source state through direct helper flows.
  - Legacy concern: source provisioning still bypasses `SourceProvisioning` orchestration runtime.

- `services/api/src/utils/source-destination-mappings.ts`
  - Reachability: source mapping routes mutate mapping graph directly.
  - Legacy concern: sync lifecycle triggering still helper-driven (`enqueuePushSync`) instead of runtime-authoritative.

## Deleted in This Slice

- Removed cron migration-flag branch and migration gate:
  - deleted `services/cron/src/migration-check.ts`
  - deleted `services/cron/src/migration-check.test.ts`
  - removed `WORKER_JOB_QUEUE_ENABLED` handling from:
    - `services/cron/src/env.ts`
    - `services/cron/src/index.ts`
    - `services/cron/src/jobs/push-destinations.ts`

This is a clean-cut decision: cron now always enqueues destination sync jobs.

## Next Deletion Slices

- **F2/F3/F4/F5 (worker+sync):**
  - Replace `syncDestinationsForUser` entrypoint with a runtime-authoritative orchestrator service.
  - Remove `packages/sync/src/sync-user.ts` export surface after replacement.

- **F6 (api source provisioning):**
  - Route source create/import/mapping workflows through `SourceProvisioning` + `SyncLifecycle` orchestration boundary.

- **F7/F8:**
  - Delete now-orphaned helpers/tests once authoritative runtime slices land.

