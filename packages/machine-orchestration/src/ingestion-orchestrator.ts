import type {
  EventActor,
  IngestionEvent,
  IngestionMachine,
  IngestionSnapshot,
  IngestionTransitionResult,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type IngestionDomainEvent =
  | { type: "INGESTION_RUN_REQUESTED"; actorId: string }
  | { type: "REMOTE_FETCH_SUCCEEDED"; actorId: string }
  | { type: "DIFF_SUCCEEDED"; actorId: string }
  | { type: "APPLY_COMPLETED"; actorId: string; eventsAdded: number; eventsRemoved: number }
  | { type: "FETCH_AUTH_FAILED"; actorId: string; code: string }
  | { type: "FETCH_NOT_FOUND"; actorId: string; code: string }
  | { type: "FETCH_TRANSIENT_FAILED"; actorId: string; code: string }
  | { type: "FETCH_TIMEOUT"; actorId: string; code: string };

interface IngestionOrchestratorDependencies {
  machine: IngestionMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (domainEvent: IngestionDomainEvent): IngestionEvent => {
  switch (domainEvent.type) {
    case "INGESTION_RUN_REQUESTED": {
      return { type: "START" };
    }
    case "REMOTE_FETCH_SUCCEEDED": {
      return { type: "FETCH_OK" };
    }
    case "DIFF_SUCCEEDED": {
      return { type: "DIFF_OK" };
    }
    case "APPLY_COMPLETED": {
      return {
        type: "APPLY_OK",
        eventsAdded: domainEvent.eventsAdded,
        eventsRemoved: domainEvent.eventsRemoved,
      };
    }
    case "FETCH_AUTH_FAILED": {
      return { type: "FETCH_AUTH_ERROR", code: domainEvent.code };
    }
    case "FETCH_NOT_FOUND": {
      return { type: "FETCH_NOT_FOUND", code: domainEvent.code };
    }
    case "FETCH_TRANSIENT_FAILED": {
      return { type: "FETCH_TRANSIENT_ERROR", code: domainEvent.code };
    }
    case "FETCH_TIMEOUT": {
      return { type: "TIMEOUT", code: domainEvent.code };
    }
  }
};

const mapDomainActor = (domainEvent: IngestionDomainEvent): EventActor => ({ type: "worker", id: domainEvent.actorId });

class IngestionOrchestrator {
  private readonly machine: IngestionMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: IngestionOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): IngestionSnapshot {
    return this.machine.getSnapshot();
  }

  handle(domainEvent: IngestionDomainEvent): IngestionSnapshot {
    const transitionResult = this.handleTransition(domainEvent);
    return transitionResult;
  }

  handleTransition(domainEvent: IngestionDomainEvent): IngestionTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { IngestionOrchestrator };
export type {
  IngestionDomainEvent,
  IngestionOrchestratorDependencies,
};
