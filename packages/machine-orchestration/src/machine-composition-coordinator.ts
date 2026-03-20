import type {
  IngestionOutput,
  IngestionTransitionResult,
  SourceProvisioningOutput,
  SourceProvisioningTransitionResult,
} from "@keeper.sh/state-machines";
import type {
  IngestionDomainEvent,
  IngestionOrchestrator,
} from "./ingestion-orchestrator";
import type {
  SourceProvisioningDomainEvent,
  SourceProvisioningOrchestrator,
} from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";

interface SyncLifecycleEventSink {
  handle: (event: SyncLifecycleDomainEvent) => unknown;
}

interface MachineCompositionCoordinatorDependencies {
  ingestion: IngestionOrchestrator;
  sourceProvisioning: SourceProvisioningOrchestrator;
  syncLifecycle: SyncLifecycleEventSink;
}

type RoutedSyncLifecycleEventType = Extract<
  SyncLifecycleDomainEvent,
  { type: "CONTENT_CHANGED" | "SYNC_REQUESTED" }
>["type"];

const resolveSyncLifecycleEventsFromIngestionOutputs = (
  outputs: IngestionOutput[],
): SyncLifecycleDomainEvent[] => {
  const events: SyncLifecycleDomainEvent[] = [];
  const syncLifecycleEventByOutputType: Partial<Record<IngestionOutput["type"], RoutedSyncLifecycleEventType>> = {
    SOURCE_CHANGED: "CONTENT_CHANGED",
  };

  for (const output of outputs) {
    const eventType = syncLifecycleEventByOutputType[output.type];
    if (eventType) {
      events.push({ actorId: "svc-composition", type: eventType });
    }
  }
  return events;
};

const resolveSyncLifecycleEventsFromProvisioningOutputs = (
  outputs: SourceProvisioningOutput[],
): SyncLifecycleDomainEvent[] => {
  const events: SyncLifecycleDomainEvent[] = [];
  const syncLifecycleEventByOutputType: Partial<Record<SourceProvisioningOutput["type"], RoutedSyncLifecycleEventType>> = {
    BOOTSTRAP_REQUESTED: "SYNC_REQUESTED",
  };

  for (const output of outputs) {
    const eventType = syncLifecycleEventByOutputType[output.type];
    if (eventType) {
      events.push({ actorId: "svc-composition", type: eventType });
    }
  }
  return events;
};

class MachineCompositionCoordinator {
  private readonly ingestion: IngestionOrchestrator;
  private readonly sourceProvisioning: SourceProvisioningOrchestrator;
  private readonly syncLifecycle: SyncLifecycleEventSink;

  constructor(dependencies: MachineCompositionCoordinatorDependencies) {
    this.ingestion = dependencies.ingestion;
    this.sourceProvisioning = dependencies.sourceProvisioning;
    this.syncLifecycle = dependencies.syncLifecycle;
  }

  handleIngestionEvent(domainEvent: IngestionDomainEvent): IngestionTransitionResult {
    const transition = this.ingestion.handleTransition(domainEvent);
    this.forwardToSyncLifecycle(resolveSyncLifecycleEventsFromIngestionOutputs(transition.outputs));
    return transition;
  }

  handleSourceProvisioningEvent(
    domainEvent: SourceProvisioningDomainEvent,
  ): SourceProvisioningTransitionResult {
    const transition = this.sourceProvisioning.handleTransition(domainEvent);
    this.forwardToSyncLifecycle(
      resolveSyncLifecycleEventsFromProvisioningOutputs(transition.outputs),
    );
    return transition;
  }

  private forwardToSyncLifecycle(events: SyncLifecycleDomainEvent[]): void {
    for (const event of events) {
      this.syncLifecycle.handle(event);
    }
  }
}

export {
  MachineCompositionCoordinator,
  resolveSyncLifecycleEventsFromIngestionOutputs,
  resolveSyncLifecycleEventsFromProvisioningOutputs,
};
export type {
  MachineCompositionCoordinatorDependencies,
  SyncLifecycleEventSink,
};
