# SyncLifecycleMachine

## Goal
Coordinate sync intent and user-visible sync status at the **user** level.

This machine is the authoritative model for:
- when a user is considered pending,
- when a push sync job should run or be superseded,
- what websocket `sync:aggregate` should represent.

It replaces fragmented transition logic currently spread across API routes, cron pending updates, and worker events.

## Scope
**In scope**
- User-level lifecycle (`idle`, `pending`, `running`, `degraded`).
- Pending reasons (ingest changed, mappings changed, settings dirty, manual trigger).
- Queue/job orchestration decisions (enqueue, supersede, release).
- Aggregate emission policy (initial status and incremental updates).

**Out of scope**
- Provider-specific fetch/sync behavior (handled by `IngestionMachine`).
- Account/source creation rules (handled by `SourceProvisioningMachine`).

## State Model
State is tracked per `userId`.

```ts
type SyncLifecycleState =
  | "idle"
  | "pending"
  | "running"
  | "degraded";
```

### Extended State (Context)
- `pendingReasons: Set<"ingest_changed" | "mappings_changed" | "settings_dirty" | "manual">`
- `activeJobId?: string`
- `lastJobStartedAt?: string`
- `lastJobFinishedAt?: string`
- `lastError?: { code: string; at: string }`
- `aggregateSeq: number`

## Events
- `INGEST_CHANGED`
- `MAPPINGS_CHANGED`
- `SETTINGS_DIRTY`
- `SETTINGS_CLEAN`
- `MANUAL_SYNC_REQUESTED`
- `JOB_ENQUEUED`
- `JOB_STARTED`
- `JOB_PROGRESS`
- `JOB_COMPLETED`
- `JOB_FAILED`
- `JOB_SUPERSEDED`
- `REAUTH_REQUIRED`

## Transition Summary
- `idle` + pending-intent event -> `pending`
- `pending` + `JOB_STARTED` -> `running`
- `running` + `JOB_COMPLETED` and no pending reasons -> `idle`
- `running` + `JOB_COMPLETED` and pending reasons remain -> `pending`
- `running` + `JOB_FAILED` -> `degraded` (or `pending` if immediately retryable)
- `degraded` + new pending-intent -> `pending`

## Side Effects
On transitions, this machine may:
- write/delete pending keys in Redis,
- update dirty markers for source settings,
- enqueue a push job with idempotency key,
- cancel/supersede stale user jobs,
- emit websocket `sync:aggregate` payloads,
- annotate wide logs with transition metadata.

All side effects should execute via effect handlers, not inline route logic.

## Integration Contracts
### Inputs from API
- Source/destination/account mapping updates.
- Source settings updates.
- Manual “sync now” requests.

### Inputs from Cron / Ingestion
- “source changed” facts from ingestion.

### Inputs from Worker
- job `active/completed/failed/progress`.

### Outputs
- queue commands (`enqueue`, `cancel`),
- websocket broadcast commands,
- redis pending/dirty updates.

## Reliability Requirements
- Idempotent transition handling by `(userId, eventId)`.
- Deterministic reducers (pure state transition function).
- At-least-once event safety for worker/cron signals.
- No user-level double-running semantics (single active job ownership per user).

## Suggested Persistence
- Hot state: Redis hash per user.
- Audit/debug stream: append-only transition log (optional DB table).

## Migration Plan
1. Introduce machine reducer + effect interface.
2. Route existing pending/broadcast calls through machine APIs.
3. Connect worker and cron event producers.
4. Remove duplicate pending orchestration code paths.

