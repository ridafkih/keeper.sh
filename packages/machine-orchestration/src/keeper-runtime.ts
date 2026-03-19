import type { IngestionTransitionResult, SourceProvisioningTransitionResult, SyncLifecycleSnapshot } from "@keeper.sh/state-machines";
import type { IngestionDomainEvent } from "./ingestion-orchestrator";
import type { MachineCompositionCoordinator } from "./machine-composition-coordinator";
import type { SourceProvisioningDomainEvent } from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";

interface SyncLifecycleRuntimePort {
  handle: (event: SyncLifecycleDomainEvent) => SyncLifecycleSnapshot;
  getSnapshot: () => SyncLifecycleSnapshot;
}

interface MachineCompositionCoordinatorPort {
  handleIngestionEvent: (event: IngestionDomainEvent) => IngestionTransitionResult;
  handleSourceProvisioningEvent: (
    event: SourceProvisioningDomainEvent,
  ) => SourceProvisioningTransitionResult;
}

interface KeeperRuntimeDependencies {
  compositionCoordinator: MachineCompositionCoordinatorPort | MachineCompositionCoordinator;
  syncLifecycle: SyncLifecycleRuntimePort;
}

class KeeperRuntime {
  private readonly compositionCoordinator: MachineCompositionCoordinatorPort;
  private readonly syncLifecycle: SyncLifecycleRuntimePort;

  constructor(dependencies: KeeperRuntimeDependencies) {
    this.compositionCoordinator = dependencies.compositionCoordinator;
    this.syncLifecycle = dependencies.syncLifecycle;
  }

  handleIngestionEvent(event: IngestionDomainEvent): IngestionTransitionResult {
    return this.compositionCoordinator.handleIngestionEvent(event);
  }

  handleSourceProvisioningEvent(
    event: SourceProvisioningDomainEvent,
  ): SourceProvisioningTransitionResult {
    return this.compositionCoordinator.handleSourceProvisioningEvent(event);
  }

  handleSyncLifecycleEvent(event: SyncLifecycleDomainEvent): SyncLifecycleSnapshot {
    return this.syncLifecycle.handle(event);
  }

  getSyncLifecycleSnapshot(): SyncLifecycleSnapshot {
    return this.syncLifecycle.getSnapshot();
  }
}

export { KeeperRuntime };
export type {
  KeeperRuntimeDependencies,
  MachineCompositionCoordinatorPort,
  SyncLifecycleRuntimePort,
};
