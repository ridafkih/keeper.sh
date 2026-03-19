import { describe, expect, it } from "bun:test";
import {
  IngestionStateMachine,
  SourceProvisioningStateMachine,
  TransitionPolicy,
  createEventEnvelope,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { IngestionOrchestrator } from "./ingestion-orchestrator";
import { MachineCompositionCoordinator } from "./machine-composition-coordinator";
import { SourceProvisioningOrchestrator } from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";

const buildEnvelopeFactory = (prefix: string): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return createEventEnvelope(event, actor, {
        id: `${prefix}-${sequence}`,
        occurredAt: `2026-03-19T11:30:${String(sequence).padStart(2, "0")}.000Z`,
      });
    },
  };
};

describe("MachineCompositionCoordinator", () => {
  it("routes ingestion SOURCE_CHANGED output into sync CONTENT_CHANGED", () => {
    const syncEvents: SyncLifecycleDomainEvent[] = [];
    const coordinator = new MachineCompositionCoordinator({
      ingestion: new IngestionOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-ingest"),
        machine: new IngestionStateMachine({
          accountId: "acct-1",
          provider: "google",
          sourceCalendarId: "src-1",
          userId: "user-1",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      sourceProvisioning: new SourceProvisioningOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-provision"),
        machine: new SourceProvisioningStateMachine({
          mode: "create_single",
          provider: "google",
          requestId: "req-1",
          userId: "user-1",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      syncLifecycle: {
        handle: (event) => {
          syncEvents.push(event);
        },
      },
    });

    coordinator.handleIngestionEvent({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    coordinator.handleIngestionEvent({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
    coordinator.handleIngestionEvent({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
    coordinator.handleIngestionEvent({
      actorId: "svc-worker",
      eventsAdded: 1,
      eventsRemoved: 0,
      type: "APPLY_COMPLETED",
    });

    expect(syncEvents).toEqual([{ actorId: "svc-composition", type: "CONTENT_CHANGED" }]);
  });

  it("routes provisioning BOOTSTRAP_REQUESTED output into sync SYNC_REQUESTED", () => {
    const syncEvents: SyncLifecycleDomainEvent[] = [];
    const coordinator = new MachineCompositionCoordinator({
      ingestion: new IngestionOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-ingest"),
        machine: new IngestionStateMachine({
          accountId: "acct-2",
          provider: "google",
          sourceCalendarId: "src-2",
          userId: "user-2",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      sourceProvisioning: new SourceProvisioningOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-provision"),
        machine: new SourceProvisioningStateMachine({
          mode: "create_single",
          provider: "google",
          requestId: "req-2",
          userId: "user-2",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      syncLifecycle: {
        handle: (event) => {
          syncEvents.push(event);
        },
      },
    });

    coordinator.handleSourceProvisioningEvent({ actorId: "user-2", type: "REQUEST_VALIDATED" });
    coordinator.handleSourceProvisioningEvent({ actorId: "svc-billing", type: "QUOTA_GRANTED" });
    coordinator.handleSourceProvisioningEvent({ actorId: "svc-api", type: "DEDUPLICATION_PASSED" });
    coordinator.handleSourceProvisioningEvent({ actorId: "svc-api", accountId: "acc-2", type: "ACCOUNT_CREATED" });
    coordinator.handleSourceProvisioningEvent({ actorId: "svc-api", sourceIds: ["src-2"], type: "SOURCE_CREATED" });
    coordinator.handleSourceProvisioningEvent({
      actorId: "svc-api",
      mode: "create_single",
      sourceIds: ["src-2"],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });

    expect(syncEvents).toEqual([{ actorId: "svc-composition", type: "SYNC_REQUESTED" }]);
  });

  it("does not route sync event for rejected provisioning flow", () => {
    const syncEvents: SyncLifecycleDomainEvent[] = [];
    const coordinator = new MachineCompositionCoordinator({
      ingestion: new IngestionOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-ingest"),
        machine: new IngestionStateMachine({
          accountId: "acct-3",
          provider: "google",
          sourceCalendarId: "src-3",
          userId: "user-3",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      sourceProvisioning: new SourceProvisioningOrchestrator({
        envelopeFactory: buildEnvelopeFactory("env-comp-provision"),
        machine: new SourceProvisioningStateMachine({
          mode: "create_single",
          provider: "ics",
          requestId: "req-3",
          userId: "user-3",
        }, { transitionPolicy: TransitionPolicy.IGNORE }),
      }),
      syncLifecycle: {
        handle: (event) => {
          syncEvents.push(event);
        },
      },
    });

    coordinator.handleSourceProvisioningEvent({ actorId: "user-3", type: "REQUEST_VALIDATED" });
    coordinator.handleSourceProvisioningEvent({ actorId: "svc-billing", type: "QUOTA_EXCEEDED" });

    expect(syncEvents).toEqual([]);
  });
});
