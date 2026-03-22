import type {
  DestinationExecutionEvent,
  DestinationExecutionMachine,
  DestinationExecutionSnapshot,
  DestinationExecutionTransitionResult,
  EventActor,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type DestinationExecutionDomainEvent =
  | { type: "LOCK_WAIT_STARTED"; actorId: string; holderId: string }
  | { type: "LOCK_ACQUIRED"; actorId: string; holderId: string }
  | { type: "EXECUTION_STARTED"; actorId: string }
  | {
      type: "EXECUTION_SUCCEEDED";
      actorId: string;
      eventsAdded: number;
      eventsRemoved: number;
    }
  | { type: "INVALIDATION_DETECTED"; actorId: string; at: string }
  | {
      type: "EXECUTION_RETRYABLE_FAILED";
      actorId: string;
      code: string;
      nextAttemptAt: string;
    }
  | { type: "EXECUTION_FATAL_FAILED"; actorId: string; code: string; reason: string };

interface DestinationExecutionOrchestratorDependencies {
  machine: DestinationExecutionMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: DestinationExecutionDomainEvent,
): DestinationExecutionEvent => {
  switch (domainEvent.type) {
    case "LOCK_WAIT_STARTED":
    case "LOCK_ACQUIRED": {
      return { type: domainEvent.type, holderId: domainEvent.holderId };
    }
    case "EXECUTION_STARTED": {
      return { type: "EXECUTION_STARTED" };
    }
    case "EXECUTION_SUCCEEDED": {
      return {
        type: "EXECUTION_SUCCEEDED",
        eventsAdded: domainEvent.eventsAdded,
        eventsRemoved: domainEvent.eventsRemoved,
      };
    }
    case "INVALIDATION_DETECTED": {
      return { type: "INVALIDATION_DETECTED", at: domainEvent.at };
    }
    case "EXECUTION_RETRYABLE_FAILED": {
      return {
        type: "EXECUTION_RETRYABLE_FAILED",
        code: domainEvent.code,
        nextAttemptAt: domainEvent.nextAttemptAt,
      };
    }
    case "EXECUTION_FATAL_FAILED": {
      return {
        type: "EXECUTION_FATAL_FAILED",
        code: domainEvent.code,
        reason: domainEvent.reason,
      };
    }
  }
};

const mapDomainActor = (domainEvent: DestinationExecutionDomainEvent): EventActor => ({ type: "worker", id: domainEvent.actorId });

class DestinationExecutionOrchestrator {
  private readonly machine: DestinationExecutionMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: DestinationExecutionOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): DestinationExecutionSnapshot {
    return this.machine.getSnapshot();
  }

  handle(
    domainEvent: DestinationExecutionDomainEvent,
  ): DestinationExecutionTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(
    domainEvent: DestinationExecutionDomainEvent,
  ): DestinationExecutionTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { DestinationExecutionOrchestrator };
export type {
  DestinationExecutionDomainEvent,
  DestinationExecutionOrchestratorDependencies,
};
