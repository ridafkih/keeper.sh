import {
  CredentialHealthStateMachine,
  DestinationExecutionStateMachine,
  IngestionStateMachine,
  PushJobArbitrationStateMachine,
  SourceIngestionLifecycleStateMachine,
  SourceProvisioningStateMachine,
  SyncLifecycleStateMachine,
  SyncTokenStrategyStateMachine,
} from "@keeper.sh/state-machines";
import type {
  CredentialHealthContext,
  DestinationExecutionContext,
  IngestionMachineInput,
  SourceIngestionLifecycleContext,
  SourceProvisioningInput,
  SyncTokenStrategyContext,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import { CredentialHealthOrchestrator } from "./credential-health-orchestrator";
import { DestinationExecutionOrchestrator } from "./destination-execution-orchestrator";
import type { EnvelopeFactory } from "./envelope-factory";
import { IngestionOrchestrator } from "./ingestion-orchestrator";
import { KeeperRuntime } from "./keeper-runtime";
import { MachineCompositionCoordinator } from "./machine-composition-coordinator";
import { PushJobArbitrationOrchestrator } from "./push-job-arbitration-orchestrator";
import { SourceIngestionLifecycleOrchestrator } from "./source-ingestion-lifecycle-orchestrator";
import { SourceProvisioningOrchestrator } from "./source-provisioning-orchestrator";
import { SyncLifecycleOrchestrator } from "./sync-lifecycle-orchestrator";
import { SyncTokenStrategyOrchestrator } from "./sync-token-strategy-orchestrator";
import type {
  SyncLifecycleBroadcastPort,
  SyncLifecycleJobCoordinatorPort,
} from "./sync-lifecycle-orchestrator";

interface CreateKeeperRuntimeDependencies {
  userId: string;
  transitionPolicy: TransitionPolicy;
  envelopeFactory: EnvelopeFactory;
  ingestionInput: IngestionMachineInput;
  sourceProvisioningInput: SourceProvisioningInput;
  destinationExecutionContext: Pick<DestinationExecutionContext, "calendarId" | "failureCount">;
  sourceIngestionLifecycleContext: Pick<SourceIngestionLifecycleContext, "provider" | "sourceId">;
  credentialHealthContext: Pick<
    CredentialHealthContext,
    "accessTokenExpiresAt" | "calendarAccountId" | "oauthCredentialId"
  >;
  syncTokenStrategyContext: Pick<SyncTokenStrategyContext, "requiredWindowVersion">;
  jobCoordinator: SyncLifecycleJobCoordinatorPort;
  broadcaster: SyncLifecycleBroadcastPort;
}

const createKeeperRuntime = (
  dependencies: CreateKeeperRuntimeDependencies,
): KeeperRuntime => {
  const syncLifecycleMachine = new SyncLifecycleStateMachine({
    transitionPolicy: dependencies.transitionPolicy,
  });

  const ingestionMachine = new IngestionStateMachine(
    dependencies.ingestionInput,
    { transitionPolicy: dependencies.transitionPolicy },
  );

  const sourceProvisioningMachine = new SourceProvisioningStateMachine(
    dependencies.sourceProvisioningInput,
    { transitionPolicy: dependencies.transitionPolicy },
  );
  const pushJobArbitrationMachine = new PushJobArbitrationStateMachine({
    transitionPolicy: dependencies.transitionPolicy,
  });
  const destinationExecutionMachine = new DestinationExecutionStateMachine(
    dependencies.destinationExecutionContext,
    { transitionPolicy: dependencies.transitionPolicy },
  );
  const sourceIngestionLifecycleMachine = new SourceIngestionLifecycleStateMachine(
    dependencies.sourceIngestionLifecycleContext,
    { transitionPolicy: dependencies.transitionPolicy },
  );
  const credentialHealthMachine = new CredentialHealthStateMachine(
    dependencies.credentialHealthContext,
    { transitionPolicy: dependencies.transitionPolicy },
  );
  const syncTokenStrategyMachine = new SyncTokenStrategyStateMachine(
    dependencies.syncTokenStrategyContext,
    { transitionPolicy: dependencies.transitionPolicy },
  );

  const syncLifecycle = new SyncLifecycleOrchestrator({
    broadcaster: dependencies.broadcaster,
    envelopeFactory: dependencies.envelopeFactory,
    jobCoordinator: dependencies.jobCoordinator,
    machine: syncLifecycleMachine,
    userId: dependencies.userId,
  });

  const ingestion = new IngestionOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: ingestionMachine,
  });

  const sourceProvisioning = new SourceProvisioningOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: sourceProvisioningMachine,
  });
  const pushJobArbitration = new PushJobArbitrationOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: pushJobArbitrationMachine,
  });
  const destinationExecution = new DestinationExecutionOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: destinationExecutionMachine,
  });
  const sourceIngestionLifecycle = new SourceIngestionLifecycleOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: sourceIngestionLifecycleMachine,
  });
  const credentialHealth = new CredentialHealthOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: credentialHealthMachine,
  });
  const syncTokenStrategy = new SyncTokenStrategyOrchestrator({
    envelopeFactory: dependencies.envelopeFactory,
    machine: syncTokenStrategyMachine,
  });

  const compositionCoordinator = new MachineCompositionCoordinator({
    ingestion,
    sourceProvisioning,
    syncLifecycle,
  });

  return new KeeperRuntime({
    credentialHealth,
    compositionCoordinator,
    destinationExecution,
    pushJobArbitration,
    sourceIngestionLifecycle,
    syncLifecycle,
    syncTokenStrategy,
  });
};

export { createKeeperRuntime };
export type { CreateKeeperRuntimeDependencies };
