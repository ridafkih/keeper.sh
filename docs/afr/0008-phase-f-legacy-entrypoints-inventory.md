# 0008 — Phase F Legacy Entrypoints Inventory (F1)

Status: `active`
Scope: Phase F clean-cut migration

## Reachable Legacy Entrypoints

- None.
- Worker sync runtime now resolves through `@keeper.sh/machine-orchestration` and no longer imports `@keeper.sh/sync`.
- `packages/sync` package has been removed.

- `services/api/src/utils/source-lifecycle.ts`, `services/api/src/utils/oauth-sources.ts`, `services/api/src/utils/caldav-sources.ts`
  - Reachability: API source routes create/update source state through direct helper flows.
  - Legacy concern: source provisioning still bypasses `SourceProvisioning` orchestration runtime.

- `services/api/src/utils/source-destination-mappings.ts`
  - Reachability: source mapping routes mutate mapping graph directly.
  - Legacy concern: sync lifecycle triggering still helper-driven (`enqueuePushSync`) instead of runtime-authoritative.

## Deleted in Prior Slice

- Removed cron migration-flag branch and migration gate:
  - deleted `services/cron/src/migration-check.ts`
  - deleted `services/cron/src/migration-check.test.ts`
  - removed `WORKER_JOB_QUEUE_ENABLED` handling from:
    - `services/cron/src/env.ts`
    - `services/cron/src/index.ts`
    - `services/cron/src/jobs/push-destinations.ts`

This is a clean-cut decision: cron now always enqueues destination sync jobs.

## Deleted in This Slice

- Removed legacy `sync-user` entrypoint/module surface:
  - deleted `packages/sync/src/sync-user.ts`
  - deleted `packages/sync/src/sync-user-dispatch-table.ts`
  - deleted `packages/sync/src/sync-user-dispatch-table.test.ts`
- Replaced with runtime-authoritative naming/surface:
  - `packages/sync/src/keeper-sync-runtime.ts`
  - `packages/sync/src/keeper-sync-runtime-dispatch-table.ts`
  - `packages/sync/src/keeper-sync-runtime-dispatch-table.test.ts`
  - `packages/sync/src/index.ts` now exports `runKeeperSyncRuntimeForUser`
- Updated worker call site:
  - `services/worker/src/processor.ts` now invokes `runKeeperSyncRuntimeForUser`

## Build-Graph Verification

- Verified no runtime imports remain for deleted legacy paths:
  - `migration-check`
  - `sync-user.ts`
  - `sync-user-dispatch-table`
  - `syncDestinationsForUser`
- Command used:
  - `rg -n "migration-check|sync-user\\.ts|sync-user-dispatch-table|syncDestinationsForUser" services packages -S`

## Completed Deletion Slices

- **F2/F3/F4/F5 (worker+sync):**
  - moved sync runtime stack from `packages/sync/src/*` to `packages/machine-orchestration/src/*`
  - worker now imports `runKeeperSyncRuntimeForUser` via `services/worker/src/runtime/sync-runtime.ts` from `@keeper.sh/machine-orchestration`
  - deleted `packages/sync` package (`package.json`, `tsconfig.json`, `src/index.ts`)

- **F6 (api source provisioning):**
  - `ICS create-source` path is now machine-wired at lifecycle level:
    - `services/api/src/utils/source-lifecycle.ts` dispatches `SourceProvisioningStateMachine` transitions.
    - bootstrap sync spawn is guarded by machine output (`BOOTSTRAP_REQUESTED`) invariant.
  - `OAuth + CalDAV create/import` paths are now machine-wired:
    - `services/api/src/utils/oauth-sources.ts`
    - `services/api/src/utils/caldav-sources.ts`
  - Runtime invariant now enforced on all provisioning create/import paths:
    - bootstrap sync trigger must produce `BOOTSTRAP_REQUESTED` output.
  - Remaining work:
    - source-destination mapping mutation flow is still helper-driven and should be evaluated for machine boundary extraction in a separate slice.

- **F7/F8:**
  - Delete now-orphaned helpers/tests once authoritative runtime slices land.
