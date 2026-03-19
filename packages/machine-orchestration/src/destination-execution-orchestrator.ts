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
  if (domainEvent.type === "LOCK_WAIT_STARTED" || domainEvent.type === "LOCK_ACQUIRED") {
    return { type: domainEvent.type, holderId: domainEvent.holderId };
  }
  if (domainEvent.type === "EXECUTION_STARTED") {
    return { type: "EXECUTION_STARTED" };
  }
  if (domainEvent.type === "EXECUTION_SUCCEEDED") {
    return {
      type: "EXECUTION_SUCCEEDED",
      eventsAdded: domainEvent.eventsAdded,
      eventsRemoved: domainEvent.eventsRemoved,
    };
  }
  if (domainEvent.type === "INVALIDATION_DETECTED") {
    return { type: "INVALIDATION_DETECTED", at: domainEvent.at };
  }
  if (domainEvent.type === "EXECUTION_RETRYABLE_FAILED") {
    return {
      type: "EXECUTION_RETRYABLE_FAILED",
      code: domainEvent.code,
      nextAttemptAt: domainEvent.nextAttemptAt,
    };
  }
  return {
    type: "EXECUTION_FATAL_FAILED",
    code: domainEvent.code,
    reason: domainEvent.reason,
  };
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
