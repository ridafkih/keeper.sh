# Keeper Runtime

## Goal
Provide a single, explicit runtime entrypoint for machine-driven backend orchestration.

## Core API
- `createKeeperRuntime(dependencies)` constructs a fully wired runtime.
- `runtime.handleIngestionEvent(...)` routes ingestion domain events.
- `runtime.handleSourceProvisioningEvent(...)` routes source provisioning domain events.
- `runtime.handleSyncLifecycleEvent(...)` routes direct sync lifecycle events.
- `runtime.getSyncLifecycleSnapshot()` returns current sync lifecycle snapshot.

## Construction
`createKeeperRuntime` requires explicit dependencies (no runtime defaults):
- `userId`
- `transitionPolicy`
- `envelopeFactory`
- `ingestionInput`
- `sourceProvisioningInput`
- `jobCoordinator`
- `broadcaster`

## Example
```ts
import { TransitionPolicy } from "@keeper.sh/state-machines";
import { createKeeperRuntime } from "@keeper.sh/machine-orchestration";

const runtime = createKeeperRuntime({
  userId: "user-1",
  transitionPolicy: TransitionPolicy.IGNORE,
  envelopeFactory: {
    createEnvelope: (event, actor) => ({
      id: crypto.randomUUID(),
      event,
      actor,
      occurredAt: new Date().toISOString(),
    }),
  },
  ingestionInput: {
    accountId: "acc-1",
    provider: "google",
    sourceCalendarId: "src-1",
    userId: "user-1",
  },
  sourceProvisioningInput: {
    mode: "create_single",
    provider: "google",
    requestId: "req-1",
    userId: "user-1",
  },
  jobCoordinator: {
    requestEnqueueIdempotent: (userId, idempotencyKey) => {
      // enqueue idempotently
    },
  },
  broadcaster: {
    publishLifecycleUpdate: (userId) => {
      // publish sync lifecycle update
    },
  },
});
```

## Example Flow
```ts
runtime.handleIngestionEvent({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
runtime.handleIngestionEvent({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
runtime.handleIngestionEvent({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
runtime.handleIngestionEvent({
  actorId: "svc-worker",
  eventsAdded: 2,
  eventsRemoved: 0,
  type: "APPLY_COMPLETED",
});
```

If ingestion outputs `SOURCE_CHANGED`, composition forwards `CONTENT_CHANGED` to sync lifecycle orchestration, which can emit enqueue commands via the injected `jobCoordinator`.

## Notes
- Orchestrators are transition adapters; they do not hide side effects.
- Cross-machine routing is handled by `MachineCompositionCoordinator`.
- Envelope metadata is caller-owned via `envelopeFactory`.
