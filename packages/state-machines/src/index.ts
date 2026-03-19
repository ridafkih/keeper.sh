export { StateMachine } from "./core/state-machine";
export type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
export { createEventEnvelope } from "./core/event-envelope";
export type { EventActor, EventEnvelope, EventEnvelopeOptions } from "./core/event-envelope";
export { withMachineSubscription } from "./core/with-subscription";
export { TransitionPolicy } from "./core/transition-policy";
export { ErrorPolicy } from "./errors/error-policy";

export { SyncLifecycleStateMachine } from "./sync-lifecycle.machine";
export type {
  PendingReason,
  SyncLifecycleCommand,
  SyncLifecycleContext,
  SyncLifecycleEvent,
  SyncLifecycleMachine,
  SyncLifecycleSnapshot,
  SyncLifecycleState,
  SyncLifecycleTransitionResult,
} from "./sync-lifecycle.machine";

export { IngestionFailureType, IngestionStateMachine } from "./ingestion.machine";
export type {
  IngestionCommand,
  IngestionContext,
  IngestionEvent,
  IngestionMachine,
  IngestionMachineInput,
  IngestionOutput,
  IngestionProvider,
  IngestionSnapshot,
  IngestionState,
  IngestionTransitionResult,
} from "./ingestion.machine";

export { SourceProvisioningStateMachine } from "./source-provisioning.machine";
export type {
  SourceProvisioningCommand,
  SourceProvisioningContext,
  SourceProvisioningEvent,
  SourceProvisioningInput,
  SourceProvisioningMachine,
  SourceProvisioningMode,
  SourceProvisioningOutput,
  SourceProvisioningProvider,
  SourceProvisioningRejectionReason,
  SourceProvisioningSnapshot,
  SourceProvisioningState,
  SourceProvisioningTransitionResult,
} from "./source-provisioning.machine";

export {
  resolveSyncLifecycleEventsFromIngestionOutputs,
  resolveSyncLifecycleEventsFromProvisioningOutputs,
} from "./orchestration/machine-coordinator";
export { SyncLifecycleApplicationService } from "./orchestration/sync-lifecycle.application-service";
export type {
  JobCoordinator,
  SyncLifecycleBroadcaster,
  SyncLifecycleApplicationServiceDependencies,
} from "./orchestration/sync-lifecycle.application-service";
