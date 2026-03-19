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
import type { CredentialHealthDomainEvent } from "./credential-health-orchestrator";
import type { DestinationExecutionDomainEvent } from "./destination-execution-orchestrator";
import type { IngestionDomainEvent } from "./ingestion-orchestrator";
import type { MachineCompositionCoordinator } from "./machine-composition-coordinator";
import type { PushJobArbitrationDomainEvent } from "./push-job-arbitration-orchestrator";
import type { SourceIngestionLifecycleDomainEvent } from "./source-ingestion-lifecycle-orchestrator";
import type { SourceProvisioningDomainEvent } from "./source-provisioning-orchestrator";
import type { SyncLifecycleDomainEvent } from "./sync-lifecycle-orchestrator";
import type { SyncTokenStrategyDomainEvent } from "./sync-token-strategy-orchestrator";

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

interface PushJobArbitrationRuntimePort {
  handle: (event: PushJobArbitrationDomainEvent) => PushJobArbitrationTransitionResult;
}

interface DestinationExecutionRuntimePort {
  handle: (event: DestinationExecutionDomainEvent) => DestinationExecutionTransitionResult;
}

interface SourceIngestionLifecycleRuntimePort {
  handle: (
    event: SourceIngestionLifecycleDomainEvent,
  ) => SourceIngestionLifecycleTransitionResult;
}

interface CredentialHealthRuntimePort {
  handle: (event: CredentialHealthDomainEvent) => CredentialHealthTransitionResult;
}

interface SyncTokenStrategyRuntimePort {
  handle: (event: SyncTokenStrategyDomainEvent) => SyncTokenStrategyTransitionResult;
}

interface KeeperRuntimeDependencies {
  compositionCoordinator: MachineCompositionCoordinatorPort | MachineCompositionCoordinator;
  syncLifecycle: SyncLifecycleRuntimePort;
  pushJobArbitration: PushJobArbitrationRuntimePort;
  destinationExecution: DestinationExecutionRuntimePort;
  sourceIngestionLifecycle: SourceIngestionLifecycleRuntimePort;
  credentialHealth: CredentialHealthRuntimePort;
  syncTokenStrategy: SyncTokenStrategyRuntimePort;
}

class KeeperRuntime {
  private readonly compositionCoordinator: MachineCompositionCoordinatorPort;
  private readonly syncLifecycle: SyncLifecycleRuntimePort;
  private readonly pushJobArbitration: PushJobArbitrationRuntimePort;
  private readonly destinationExecution: DestinationExecutionRuntimePort;
  private readonly sourceIngestionLifecycle: SourceIngestionLifecycleRuntimePort;
  private readonly credentialHealth: CredentialHealthRuntimePort;
  private readonly syncTokenStrategy: SyncTokenStrategyRuntimePort;

  constructor(dependencies: KeeperRuntimeDependencies) {
    this.compositionCoordinator = dependencies.compositionCoordinator;
    this.syncLifecycle = dependencies.syncLifecycle;
    this.pushJobArbitration = dependencies.pushJobArbitration;
    this.destinationExecution = dependencies.destinationExecution;
    this.sourceIngestionLifecycle = dependencies.sourceIngestionLifecycle;
    this.credentialHealth = dependencies.credentialHealth;
    this.syncTokenStrategy = dependencies.syncTokenStrategy;
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

  handlePushJobArbitrationEvent(
    event: PushJobArbitrationDomainEvent,
  ): PushJobArbitrationTransitionResult {
    return this.pushJobArbitration.handle(event);
  }

  handleDestinationExecutionEvent(
    event: DestinationExecutionDomainEvent,
  ): DestinationExecutionTransitionResult {
    return this.destinationExecution.handle(event);
  }

  handleSourceIngestionLifecycleEvent(
    event: SourceIngestionLifecycleDomainEvent,
  ): SourceIngestionLifecycleTransitionResult {
    return this.sourceIngestionLifecycle.handle(event);
  }

  handleCredentialHealthEvent(
    event: CredentialHealthDomainEvent,
  ): CredentialHealthTransitionResult {
    return this.credentialHealth.handle(event);
  }

  handleSyncTokenStrategyEvent(
    event: SyncTokenStrategyDomainEvent,
  ): SyncTokenStrategyTransitionResult {
    return this.syncTokenStrategy.handle(event);
  }
}

export { KeeperRuntime };
export type {
  CredentialHealthRuntimePort,
  DestinationExecutionRuntimePort,
  KeeperRuntimeDependencies,
  MachineCompositionCoordinatorPort,
  PushJobArbitrationRuntimePort,
  SourceIngestionLifecycleRuntimePort,
  SyncLifecycleRuntimePort,
  SyncTokenStrategyRuntimePort,
};
