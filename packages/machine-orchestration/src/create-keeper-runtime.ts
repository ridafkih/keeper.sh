import {
  IngestionStateMachine,
  SourceProvisioningStateMachine,
  SyncLifecycleStateMachine,
} from "@keeper.sh/state-machines";
import type {
  IngestionMachineInput,
  SourceProvisioningInput,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { IngestionOrchestrator } from "./ingestion-orchestrator";
import { KeeperRuntime } from "./keeper-runtime";
import { MachineCompositionCoordinator } from "./machine-composition-coordinator";
import { SourceProvisioningOrchestrator } from "./source-provisioning-orchestrator";
import { SyncLifecycleOrchestrator } from "./sync-lifecycle-orchestrator";
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

  const compositionCoordinator = new MachineCompositionCoordinator({
    ingestion,
    sourceProvisioning,
    syncLifecycle,
  });

  return new KeeperRuntime({
    compositionCoordinator,
    syncLifecycle,
  });
};

export { createKeeperRuntime };
export type { CreateKeeperRuntimeDependencies };
