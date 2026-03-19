import type {
  EventActor,
  SourceDiffReconciliationEvent,
  SourceDiffReconciliationMachine,
  SourceDiffReconciliationSnapshot,
  SourceDiffReconciliationTransitionResult,
} from "@keeper.sh/state-machines";
import { SourceDiffReconciliationEventType } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type SourceDiffReconciliationDomainEvent =
  | { type: typeof SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED; actorId: string }
  | {
    type: typeof SourceDiffReconciliationEventType.DIFF_COMPUTED;
    actorId: string;
    addedCount: number;
    updatedCount: number;
    removedCount: number;
  }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_STARTED; actorId: string }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_SUCCEEDED; actorId: string }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED; actorId: string; code: string }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_FATAL_FAILED; actorId: string; code: string };

interface SourceDiffReconciliationOrchestratorDependencies {
  machine: SourceDiffReconciliationMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: SourceDiffReconciliationDomainEvent,
): SourceDiffReconciliationEvent => {
  switch (domainEvent.type) {
    case SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED: {
      return { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED };
    }
    case SourceDiffReconciliationEventType.DIFF_COMPUTED: {
      return {
        type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
        addedCount: domainEvent.addedCount,
        removedCount: domainEvent.removedCount,
        updatedCount: domainEvent.updatedCount,
      };
    }
    case SourceDiffReconciliationEventType.APPLY_STARTED: {
      return { type: SourceDiffReconciliationEventType.APPLY_STARTED };
    }
    case SourceDiffReconciliationEventType.APPLY_SUCCEEDED: {
      return { type: SourceDiffReconciliationEventType.APPLY_SUCCEEDED };
    }
    case SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED: {
      return { type: SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED, code: domainEvent.code };
    }
    case SourceDiffReconciliationEventType.APPLY_FATAL_FAILED: {
      return { type: SourceDiffReconciliationEventType.APPLY_FATAL_FAILED, code: domainEvent.code };
    }
    default: {
      throw new Error("Unhandled source diff reconciliation domain event");
    }
  }
};

const mapDomainActor = (domainEvent: SourceDiffReconciliationDomainEvent): EventActor => ({
  type: "worker",
  id: domainEvent.actorId,
});

class SourceDiffReconciliationOrchestrator {
  private readonly machine: SourceDiffReconciliationMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: SourceDiffReconciliationOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): SourceDiffReconciliationSnapshot {
    return this.machine.getSnapshot();
  }

  handle(
    domainEvent: SourceDiffReconciliationDomainEvent,
  ): SourceDiffReconciliationTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(
    domainEvent: SourceDiffReconciliationDomainEvent,
  ): SourceDiffReconciliationTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { SourceDiffReconciliationOrchestrator };
export type {
  SourceDiffReconciliationDomainEvent,
  SourceDiffReconciliationOrchestratorDependencies,
};
