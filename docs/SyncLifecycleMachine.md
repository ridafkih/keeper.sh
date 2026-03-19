# SyncLifecycleMachine

## Goal
Coordinate user-level sync lifecycle state and emit orchestration commands.

## Current Implementation
- Class: `SyncLifecycleStateMachine`
- Dispatch model: strict envelope input via `dispatch(envelope)`
- Transition policy: configurable (`TransitionPolicy.IGNORE` or `TransitionPolicy.REJECT`)
- Invariants: enforced after each transition
- Command execution owner: `SyncLifecycleApplicationService`

## States
- `idle`
- `pending`
- `running`
- `degraded`

## Context
- `pendingReasons: Set<"ingest_changed" | "mappings_changed" | "settings_dirty" | "manual">`
- `activeJobId?: string`
- `lastError?: { code: string; at: string; policy: ErrorPolicy }`

## Events
- `INGEST_CHANGED`
- `MAPPINGS_CHANGED`
- `SETTINGS_DIRTY`
- `SETTINGS_CLEAN`
- `MANUAL_SYNC_REQUESTED`
- `JOB_STARTED`
- `JOB_COMPLETED`
- `JOB_FAILED`

## Commands
- `REQUEST_PUSH_SYNC_ENQUEUE`
- `BROADCAST_AGGREGATE`

## Transition Policy and Invariants
- Invalid transitions are ignored by default, or rejected in strict mode.
- Built-in invariant: when state is `running`, `activeJobId` must be present.

## Ownership Boundary
**Machine owns**
- state transitions and command emission.

**Application service owns**
- idempotent enqueue arbitration,
- broadcast execution,
- integration with queue, transport, and logging context.

## Migration Direction
1. Route route/cron/worker sync signals through envelope dispatch.
2. Move enqueue/broadcast execution to app service command handling only.
3. Remove duplicated pending-sync checks from routes and jobs.
