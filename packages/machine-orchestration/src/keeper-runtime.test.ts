import { describe, expect, it } from "bun:test";
import type {
  CredentialHealthTransitionResult,
  DestinationExecutionTransitionResult,
  IngestionTransitionResult,
  PushJobArbitrationTransitionResult,
  SourceIngestionLifecycleTransitionResult,
  SourceProvisioningTransitionResult,
  SyncLifecycleSnapshot,
  SyncTokenStrategyTransitionResult,
} from "@keeper.sh/state-machines";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import type { CredentialHealthDomainEvent } from "./credential-health-orchestrator";
import type { DestinationExecutionDomainEvent } from "./destination-execution-orchestrator";
import { KeeperRuntime } from "./keeper-runtime";
import type { IngestionDomainEvent } from "./ingestion-orchestrator";
import type { PushJobArbitrationDomainEvent } from "./push-job-arbitration-orchestrator";
import type { SourceIngestionLifecycleDomainEvent } from "./source-ingestion-lifecycle-orchestrator";
import type { SourceProvisioningDomainEvent } from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";
import type { SyncTokenStrategyDomainEvent } from "./sync-token-strategy-orchestrator";

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
      credentialHealth: {
        handle: () => {
          throw new Error("not used");
        },
      },
      destinationExecution: {
        handle: () => {
          throw new Error("not used");
        },
      },
      pushJobArbitration: {
        handle: () => {
          throw new Error("not used");
        },
      },
      sourceIngestionLifecycle: {
        handle: () => {
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
      syncTokenStrategy: {
        handle: () => {
          throw new Error("not used");
        },
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
      credentialHealth: {
        handle: () => {
          throw new Error("not used");
        },
      },
      destinationExecution: {
        handle: () => {
          throw new Error("not used");
        },
      },
      pushJobArbitration: {
        handle: () => {
          throw new Error("not used");
        },
      },
      sourceIngestionLifecycle: {
        handle: () => {
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
      syncTokenStrategy: {
        handle: () => {
          throw new Error("not used");
        },
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
      credentialHealth: {
        handle: () => {
          throw new Error("not used");
        },
      },
      destinationExecution: {
        handle: () => {
          throw new Error("not used");
        },
      },
      pushJobArbitration: {
        handle: () => {
          throw new Error("not used");
        },
      },
      sourceIngestionLifecycle: {
        handle: () => {
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
      syncTokenStrategy: {
        handle: () => {
          throw new Error("not used");
        },
      },
    });

    const snapshot = runtime.handleSyncLifecycleEvent({ actorId: "svc-api", type: "SYNC_REQUESTED" });
    expect(calls).toEqual([{ actorId: "svc-api", type: "SYNC_REQUESTED" }]);
    expect(snapshot.state).toBe("pending");
  });

  it("routes push job arbitration events", () => {
    const calls: PushJobArbitrationDomainEvent[] = [];
    const runtime = new KeeperRuntime({
      compositionCoordinator: {
        handleIngestionEvent: () => {
          throw new Error("not used");
        },
        handleSourceProvisioningEvent: () => {
          throw new Error("not used");
        },
      },
      credentialHealth: {
        handle: () => {
          throw new Error("not used");
        },
      },
      destinationExecution: {
        handle: () => {
          throw new Error("not used");
        },
      },
      pushJobArbitration: {
        handle: (event) => {
          calls.push(event);
          return {
            commands: [{ type: "HOLD_SYNCING" }],
            context: { activeJobId: "job-1" },
            outputs: [],
            state: "active",
          } satisfies PushJobArbitrationTransitionResult;
        },
      },
      sourceIngestionLifecycle: {
        handle: () => {
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
      syncTokenStrategy: {
        handle: () => {
          throw new Error("not used");
        },
      },
    });

    const transition = runtime.handlePushJobArbitrationEvent({
      actorId: "worker-1",
      jobId: "job-1",
      type: "JOB_ACTIVATED",
    });
    expect(calls).toEqual([{ actorId: "worker-1", jobId: "job-1", type: "JOB_ACTIVATED" }]);
    expect(transition.state).toBe("active");
  });

  it("routes destination, source ingestion, credential, and token events", () => {
    const destinationCalls: DestinationExecutionDomainEvent[] = [];
    const sourceIngestionCalls: SourceIngestionLifecycleDomainEvent[] = [];
    const credentialCalls: CredentialHealthDomainEvent[] = [];
    const tokenCalls: SyncTokenStrategyDomainEvent[] = [];
    const runtime = new KeeperRuntime({
      compositionCoordinator: {
        handleIngestionEvent: () => {
          throw new Error("not used");
        },
        handleSourceProvisioningEvent: () => {
          throw new Error("not used");
        },
      },
      credentialHealth: {
        handle: (event) => {
          credentialCalls.push(event);
          return {
            commands: [{ type: "REFRESH_TOKEN" }],
            context: {
              accessTokenExpiresAt: "2026-03-19T20:00:00.000Z",
              calendarAccountId: "acct",
              oauthCredentialId: "cred",
              refreshAttempts: 0,
            },
            outputs: [],
            state: "refresh_required",
          } satisfies CredentialHealthTransitionResult;
        },
      },
      destinationExecution: {
        handle: (event) => {
          destinationCalls.push(event);
          return {
            commands: [],
            context: {
              calendarId: "cal",
              failureCount: 0,
            },
            outputs: [],
            state: "ready",
          } satisfies DestinationExecutionTransitionResult;
        },
      },
      pushJobArbitration: {
        handle: () => {
          throw new Error("not used");
        },
      },
      sourceIngestionLifecycle: {
        handle: (event) => {
          sourceIngestionCalls.push(event);
          return {
            commands: [],
            context: {
              eventsAdded: 0,
              eventsRemoved: 0,
              provider: "google",
              sourceId: "src",
            },
            outputs: [],
            state: "fetching",
          } satisfies SourceIngestionLifecycleTransitionResult;
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
      syncTokenStrategy: {
        handle: (event) => {
          tokenCalls.push(event);
          return {
            commands: [],
            context: {
              requiredWindowVersion: 1,
            },
            outputs: [],
            state: "token_missing",
          } satisfies SyncTokenStrategyTransitionResult;
        },
      },
    });

    runtime.handleDestinationExecutionEvent({
      actorId: "worker-1",
      holderId: "lock-1",
      type: "LOCK_ACQUIRED",
    });
    runtime.handleSourceIngestionLifecycleEvent({
      actorId: "worker-2",
      type: SourceIngestionLifecycleEventType.SOURCE_SELECTED,
    });
    runtime.handleCredentialHealthEvent({
      actorId: "worker-3",
      type: "TOKEN_EXPIRY_DETECTED",
    });
    runtime.handleSyncTokenStrategyEvent({
      actorId: "svc-sync",
      token: null,
      type: "TOKEN_LOADED",
    });

    expect(destinationCalls).toEqual([{ actorId: "worker-1", holderId: "lock-1", type: "LOCK_ACQUIRED" }]);
    expect(sourceIngestionCalls).toEqual([
      { actorId: "worker-2", type: SourceIngestionLifecycleEventType.SOURCE_SELECTED },
    ]);
    expect(credentialCalls).toEqual([{ actorId: "worker-3", type: "TOKEN_EXPIRY_DETECTED" }]);
    expect(tokenCalls).toEqual([{ actorId: "svc-sync", token: null, type: "TOKEN_LOADED" }]);
  });
});
