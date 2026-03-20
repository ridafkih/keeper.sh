export { StateMachine } from "./core/state-machine";
export type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
export { createEventEnvelope } from "./core/event-envelope";
export type { EventActor, EventEnvelope, EventEnvelopeMetadata } from "./core/event-envelope";
export { withMachineSubscription } from "./core/with-subscription";
export { TransitionPolicy } from "./core/transition-policy";
export { ErrorPolicy, isRetryablePolicy, isTerminalPolicy } from "./errors/error-policy";

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

export {
  PushJobArbitrationCommandType,
  PushJobArbitrationEventType,
  PushJobArbitrationStateMachine,
} from "./push-job-arbitration.machine";
export type {
  PushJobArbitrationCommand,
  PushJobArbitrationContext,
  PushJobArbitrationEvent,
  PushJobArbitrationMachine,
  PushJobArbitrationOutput,
  PushJobArbitrationSnapshot,
  PushJobArbitrationState,
  PushJobArbitrationTransitionResult,
} from "./push-job-arbitration.machine";

export {
  DestinationExecutionCommandType,
  DestinationExecutionEventType,
  DestinationExecutionStateMachine,
} from "./destination-execution.machine";
export type {
  DestinationExecutionCommand,
  DestinationExecutionContext,
  DestinationExecutionEvent,
  DestinationExecutionMachine,
  DestinationExecutionOutput,
  DestinationExecutionSnapshot,
  DestinationExecutionState,
  DestinationExecutionTransitionResult,
} from "./destination-execution.machine";

export {
  SourceIngestionLifecycleCommandType,
  SourceIngestionLifecycleEventType,
  SourceIngestionLifecycleStateMachine,
} from "./source-ingestion-lifecycle.machine";
export type {
  SourceIngestionLifecycleCommand,
  SourceIngestionLifecycleContext,
  SourceIngestionLifecycleEvent,
  SourceIngestionLifecycleMachine,
  SourceIngestionLifecycleOutput,
  SourceIngestionLifecycleSnapshot,
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleTransitionResult,
} from "./source-ingestion-lifecycle.machine";

export {
  CredentialHealthCommandType,
  CredentialHealthEventType,
  CredentialHealthStateMachine,
} from "./credential-health.machine";
export type {
  CredentialHealthCommand,
  CredentialHealthContext,
  CredentialHealthEvent,
  CredentialHealthMachine,
  CredentialHealthOutput,
  CredentialHealthSnapshot,
  CredentialHealthState,
  CredentialHealthTransitionResult,
} from "./credential-health.machine";

export { SyncTokenStrategyStateMachine } from "./sync-token-strategy.machine";
export type {
  SyncTokenStrategyCommand,
  SyncTokenStrategyContext,
  SyncTokenStrategyEvent,
  SyncTokenStrategyMachine,
  SyncTokenStrategyOutput,
  SyncTokenStrategySnapshot,
  SyncTokenStrategyState,
  SyncTokenStrategyTransitionResult,
} from "./sync-token-strategy.machine";

export {
  SourceDiffReconciliationCommandType,
  SourceDiffReconciliationEventType,
  SourceDiffReconciliationStateMachine,
} from "./source-diff-reconciliation.machine";
export type {
  SourceDiffReconciliationCommand,
  SourceDiffReconciliationContext,
  SourceDiffReconciliationEvent,
  SourceDiffReconciliationMachine,
  SourceDiffReconciliationOutput,
  SourceDiffReconciliationSnapshot,
  SourceDiffReconciliationState,
  SourceDiffReconciliationTransitionResult,
} from "./source-diff-reconciliation.machine";
