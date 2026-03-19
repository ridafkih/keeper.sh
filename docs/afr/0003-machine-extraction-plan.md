# AFR 0003: Machine Extraction Plan (Reliability + Maintainability)

- **Status:** Proposed
- **Date:** 2026-03-19
- **Owners:** Backend Platform

## Purpose
Define a concrete extraction plan to migrate high-risk orchestration logic into explicit state machines and machine-backed runtime services.

## Scope
This plan covers extraction targets for:
1. Push job arbitration
2. Destination execution
3. Source ingestion lifecycle
4. Source provisioning runtime adoption
5. Credential health / reauthentication
6. Sync token strategy

This plan keeps event diff computation as pure functional logic.

## Extraction Targets

### 1) Push Job Arbitration Machine
**Current seam**
- `/Users/ridafkih/keeper.sh/services/worker/src/index.ts`

**Responsibility**
- Per-user push job ownership and supersede/cancel behavior.
- Canonical hold/release signaling lifecycle.

**Candidate states**
- `idle`
- `active`
- `superseding`
- `settling`

**Key events**
- `JOB_ACTIVATED`
- `NEWER_JOB_DETECTED`
- `JOB_SUPERSEDE_REQUESTED`
- `JOB_COMPLETED`
- `JOB_FAILED`
- `JOB_CANCELLED`

**Invariants**
- `active` requires `activeJobId`.
- No more than one active job per user.
- Release signal must occur exactly once for terminal active-job exit.

**Commands/outputs**
- `CANCEL_JOB`
- `HOLD_SYNCING`
- `RELEASE_SYNCING`

---

### 2) Destination Execution Machine (Per Calendar)
**Current seams**
- `/Users/ridafkih/keeper.sh/packages/sync/src/sync-user.ts`
- `/Users/ridafkih/keeper.sh/packages/sync/src/sync-lock.ts`

**Responsibility**
- Lock acquire/skip/poll ownership.
- Execution progression, invalidation detection, backoff/disable transitions.

**Candidate states**
- `ready`
- `lock_pending`
- `locked`
- `executing`
- `invalidated`
- `backoff_scheduled`
- `disabled_terminal`
- `completed`

**Key events**
- `LOCK_ACQUIRED`
- `LOCK_SKIPPED`
- `LOCK_WAIT_EXPIRED`
- `EXECUTION_SUCCEEDED`
- `EXECUTION_RETRYABLE_FAILED`
- `EXECUTION_FATAL_FAILED`
- `INVALIDATION_DETECTED`
- `RELEASE_CONFIRMED`

**Invariants**
- `locked`/`executing` require `lockHolderId`.
- `disabled_terminal` requires disable reason + failure count threshold.
- Any lock-held path must emit release command before terminalization.

**Commands/outputs**
- `APPLY_BACKOFF`
- `DISABLE_DESTINATION`
- `RELEASE_LOCK`
- `EMIT_SYNC_EVENT`

---

### 3) Source Ingestion Lifecycle Machine
**Current seam**
- `/Users/ridafkih/keeper.sh/services/cron/src/jobs/ingest-sources.ts`

**Responsibility**
- Unify oauth/caldav/ics ingestion progression and error classification.
- Standardize provider-specific exceptional paths into canonical policies.

**Candidate states**
- `source_selected`
- `provider_ready`
- `fetching`
- `ingesting`
- `completed`
- `auth_blocked`
- `not_found_disabled`
- `transient_error`

**Key events**
- `SOURCE_SKIPPED`
- `FETCHER_RESOLVED`
- `FETCH_SUCCEEDED`
- `INGEST_SUCCEEDED`
- `AUTH_FAILURE`
- `NOT_FOUND`
- `TRANSIENT_FAILURE`

**Invariants**
- Terminal error states require canonical error classification.
- `completed` requires persisted ingest metrics.
- Disabled state requires explicit disable action.

**Commands/outputs**
- `MARK_NEEDS_REAUTH`
- `DISABLE_SOURCE`
- `PERSIST_SYNC_TOKEN`
- `EMIT_INGEST_METRICS`

---

### 4) Source Provisioning Runtime Adoption
**Current seams**
- `/Users/ridafkih/keeper.sh/services/api/src/utils/source-lifecycle.ts`
- `/Users/ridafkih/keeper.sh/services/api/src/utils/oauth-sources.ts`
- `/Users/ridafkih/keeper.sh/services/api/src/utils/caldav-sources.ts`

**Responsibility**
- Replace existing provisioning branching with `SourceProvisioningStateMachine` runtime path.

**Adoption goal**
- Single machine-backed provisioning path for ics/oauth/caldav creation flows.
- Remove duplicate account-limit/duplicate-source/provider-mismatch branching.

**Invariants**
- Reject paths require explicit reason.
- Bootstrap request emitted only from `done` path.

**Commands/outputs**
- `CREATE_ACCOUNT`
- `CREATE_SOURCE`
- `REQUEST_BOOTSTRAP_SYNC`

---

### 5) Credential Health / Reauth Machine
**Current seams**
- `/Users/ridafkih/keeper.sh/packages/sync/src/resolve-provider.ts`
- `/Users/ridafkih/keeper.sh/packages/calendar/src/core/oauth/source-provider.ts`

**Responsibility**
- Token freshness evaluation, coordinated refresh outcomes, reauth marking.

**Candidate states**
- `token_valid`
- `refresh_required`
- `refreshing`
- `reauth_required`
- `refresh_failed_retryable`

**Invariants**
- `reauth_required` always coupled with account update command.
- Refreshing state must have lock/coordinator context.

**Commands/outputs**
- `REFRESH_TOKEN`
- `MARK_ACCOUNT_REAUTH_REQUIRED`
- `PERSIST_REFRESHED_CREDENTIALS`

---

### 6) Sync Token Strategy Machine
**Current seams**
- OAuth provider token/window logic in provider modules.
- Shared sync-token and full-vs-delta decision code in calendar core.

**Responsibility**
- Canonical decision model for full sync, delta sync, token reset, and persistence.

**Candidate states**
- `token_missing`
- `token_valid`
- `delta_sync`
- `full_sync_required`
- `token_reset_required`
- `token_persist_pending`

**Invariants**
- Token reset state must emit token-clear command.
- Delta path requires validated token window state.

**Commands/outputs**
- `CLEAR_SYNC_TOKEN`
- `PERSIST_SYNC_TOKEN`
- `REQUEST_FULL_SYNC`

---

## Non-Machine Boundary
### Event Diff Logic Stays Functional
**Current seam**
- `/Users/ridafkih/keeper.sh/packages/calendar/src/core/source/event-diff.ts`

**Decision**
- Keep as pure functions (deterministic transforms).
- Machines orchestrate when diff runs and how outcomes are handled.

## Delivery Order
1. Push job arbitration
2. Destination execution
3. Source ingestion lifecycle
4. Source provisioning runtime adoption
5. Credential health / reauth
6. Sync token strategy

Rationale: order reduces stuck-state risk first, then consolidates highest branching paths.

## TDD Matrix (per target)
For each target machine:
1. **Happy-path transitions**
2. **Out-of-order events under `IGNORE`**
3. **Out-of-order events under `REJECT`**
4. **Stale/superseded event handling**
5. **Terminal-state re-entry prevention**
6. **Invariant violation assertion**
7. **Idempotent command emission**
8. **No-stuck-state recovery path**

## Migration Pattern (per slice)
1. Build isolated machine + orchestrator + tests.
2. Add composition wiring in `KeeperRuntime`.
3. Shadow-run in non-authoritative path where feasible.
4. Cut over single vertical flow.
5. Remove replaced legacy branching immediately.

## Definition of Done
- Machine + orchestrator for slice implemented in isolation.
- Full TDD matrix green.
- Invariants explicitly encoded.
- Runtime wiring integrated via `createKeeperRuntime`.
- Legacy logic for covered slice removed.

## Related Docs
- `/Users/ridafkih/keeper.sh/docs/afr/0001-machine-first-backend-architecture.md`
- `/Users/ridafkih/keeper.sh/docs/afr/0002-isolated-machine-implementation-plan.md`
- `/Users/ridafkih/keeper.sh/docs/KeeperRuntime.md`

## Implementation Status (2026-03-19)
- All six extraction targets are implemented as isolated machines in `/Users/ridafkih/keeper.sh/packages/state-machines/src`.
- Runtime/orchestrator slices are implemented in `/Users/ridafkih/keeper.sh/packages/machine-orchestration/src`, including `KeeperRuntime` handlers for:
  - Push job arbitration
  - Destination execution
  - Source ingestion lifecycle
  - Source provisioning
  - Credential health
  - Sync token strategy
  - Sync lifecycle

## Adversarial Coverage (2026-03-19)
- Machine tests include replay/stale-event behavior, strict-vs-ignore policy checks, and terminal re-entry rejection.
- Orchestrator tests include out-of-order dispatch rejection and stale-event arbitration checks.
- Package validation is green for both:
  - `/Users/ridafkih/keeper.sh/packages/state-machines`
  - `/Users/ridafkih/keeper.sh/packages/machine-orchestration`

## First Production Slice Cutover (2026-03-19)
- `services/worker` push job arbitration now runs through the authoritative machine runtime driver path.
- Legacy in-memory `activeJobsByUser` arbitration logic is removed from worker event handlers.
- Worker lifecycle events (`active`, `completed`, `failed`) now dispatch into `PushJobArbitrationStateMachine` via `MachineRuntimeDriver`.

## Second Production Slice Cutover (2026-03-19)
- `packages/sync` destination execution now routes through a machine runtime adapter (`DestinationExecutionStateMachine`) for lock-held execution paths.
- Success, invalidation, retryable failure, and terminal disable flows now dispatch explicit machine events and execute machine commands for release/backoff/disable.
- `sync-user` no longer owns inline backoff transition branching for lock-held destination execution.

## Third Production Slice Cutover (2026-03-19)
- `services/cron` source ingestion paths (oauth, caldav, ics) now dispatch through `SourceIngestionLifecycleStateMachine` via a dedicated runtime adapter.
- Reauth/disable behavior is executed via machine commands (`MARK_NEEDS_REAUTH`, `DISABLE_SOURCE`) instead of duplicated branch updates in provider-specific catches.
- Successful ingestion transitions now flow through explicit `FETCH_SUCCEEDED` and `INGEST_SUCCEEDED` machine events.

## Fourth Production Slice Cutover (2026-03-19)
- OAuth credential refresh in `packages/sync` now runs through a dedicated `CredentialHealthStateMachine` runtime adapter.
- Refresh success persists credentials via machine-governed transition flow; terminal auth failures mark `needsReauthentication` via machine command handling.
- `resolve-provider` coordinated refresh now wraps the machine runtime with existing distributed refresh lock coordination.
