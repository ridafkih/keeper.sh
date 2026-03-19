import { describe, expect, it } from "bun:test";
import type { IngestionTransitionResult, SourceProvisioningTransitionResult, SyncLifecycleSnapshot } from "@keeper.sh/state-machines";
import { KeeperRuntime } from "./keeper-runtime";
import type { IngestionDomainEvent } from "./ingestion-orchestrator";
import type { SourceProvisioningDomainEvent } from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";

describe("KeeperRuntime", () => {
  it("routes ingestion events through composition coordinator", () => {
    const calls: IngestionDomainEvent[] = [];
    const runtime = new KeeperRuntime({
      compositionCoordinator: {
        handleIngestionEvent: (event) => {
          calls.push(event);
          return {
            commands: [],
            context: {
              accountId: "acct",
              eventsAdded: 0,
              eventsRemoved: 0,
              provider: "google",
              sourceCalendarId: "src",
              userId: "user",
            },
            outputs: [],
            state: "fetching",
          } satisfies IngestionTransitionResult;
        },
        handleSourceProvisioningEvent: () => {
          throw new Error("not used");
        },
      },
      syncLifecycle: {
        getSnapshot: () =>
          ({
            context: { pendingReasons: new Set() },
            state: "idle",
          }) satisfies SyncLifecycleSnapshot,
        handle: () =>
          ({
            context: { pendingReasons: new Set() },
            state: "idle",
          }) satisfies SyncLifecycleSnapshot,
      },
    });

    runtime.handleIngestionEvent({ actorId: "svc", type: "INGESTION_RUN_REQUESTED" });
    expect(calls).toEqual([{ actorId: "svc", type: "INGESTION_RUN_REQUESTED" }]);
  });

  it("routes source provisioning events through composition coordinator", () => {
    const calls: SourceProvisioningDomainEvent[] = [];
    const runtime = new KeeperRuntime({
      compositionCoordinator: {
        handleIngestionEvent: () => {
          throw new Error("not used");
        },
        handleSourceProvisioningEvent: (event) => {
          calls.push(event);
          return {
            commands: [],
            context: {
              createdSourceIds: [],
              mode: "create_single",
              provider: "google",
              requestId: "req",
              userId: "user",
            },
            outputs: [],
            state: "validating",
          } satisfies SourceProvisioningTransitionResult;
        },
      },
      syncLifecycle: {
        getSnapshot: () =>
          ({
            context: { pendingReasons: new Set() },
            state: "idle",
          }) satisfies SyncLifecycleSnapshot,
        handle: () =>
          ({
            context: { pendingReasons: new Set() },
            state: "idle",
          }) satisfies SyncLifecycleSnapshot,
      },
    });

    runtime.handleSourceProvisioningEvent({ actorId: "user-1", type: "REQUEST_VALIDATED" });
    expect(calls).toEqual([{ actorId: "user-1", type: "REQUEST_VALIDATED" }]);
  });

  it("routes direct sync lifecycle events to sync orchestrator", () => {
    const calls: SyncLifecycleDomainEvent[] = [];
    const runtime = new KeeperRuntime({
      compositionCoordinator: {
        handleIngestionEvent: () => {
          throw new Error("not used");
        },
        handleSourceProvisioningEvent: () => {
          throw new Error("not used");
        },
      },
      syncLifecycle: {
        getSnapshot: () =>
          ({
            context: { pendingReasons: new Set() },
            state: "idle",
          }) satisfies SyncLifecycleSnapshot,
        handle: (event) => {
          calls.push(event);
          return {
            context: { pendingReasons: new Set(["manual"]) },
            state: "pending",
          } satisfies SyncLifecycleSnapshot;
        },
      },
    });

    const snapshot = runtime.handleSyncLifecycleEvent({ actorId: "svc-api", type: "SYNC_REQUESTED" });
    expect(calls).toEqual([{ actorId: "svc-api", type: "SYNC_REQUESTED" }]);
    expect(snapshot.state).toBe("pending");
  });
});
