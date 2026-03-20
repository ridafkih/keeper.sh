import type {
  EventActor,
  SourceIngestionLifecycleEvent,
  SourceIngestionLifecycleMachine,
  SourceIngestionLifecycleSnapshot,
  SourceIngestionLifecycleTransitionResult,
} from "@keeper.sh/state-machines";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type SourceIngestionLifecycleDomainEvent =
  | { type: SourceIngestionLifecycleEventType.SOURCE_SELECTED; actorId: string }
  | { type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED; actorId: string }
  | { type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED; actorId: string }
  | {
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED;
      actorId: string;
      eventsAdded: number;
      eventsRemoved: number;
      nextSyncToken?: string;
    }
  | { type: SourceIngestionLifecycleEventType.AUTH_FAILURE; actorId: string; code: string }
  | { type: SourceIngestionLifecycleEventType.NOT_FOUND; actorId: string; code: string }
  | { type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE; actorId: string; code: string };

interface SourceIngestionLifecycleOrchestratorDependencies {
  machine: SourceIngestionLifecycleMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: SourceIngestionLifecycleDomainEvent,
): SourceIngestionLifecycleEvent => {
  if (domainEvent.type === SourceIngestionLifecycleEventType.INGEST_SUCCEEDED) {
    return {
      type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
      eventsAdded: domainEvent.eventsAdded,
      eventsRemoved: domainEvent.eventsRemoved,
      nextSyncToken: domainEvent.nextSyncToken,
    };
  }
  if (
    domainEvent.type === SourceIngestionLifecycleEventType.AUTH_FAILURE
    || domainEvent.type === SourceIngestionLifecycleEventType.NOT_FOUND
    || domainEvent.type === SourceIngestionLifecycleEventType.TRANSIENT_FAILURE
  ) {
    return { type: domainEvent.type, code: domainEvent.code };
  }
  return { type: domainEvent.type };
};

const mapDomainActor = (domainEvent: SourceIngestionLifecycleDomainEvent): EventActor => ({ type: "worker", id: domainEvent.actorId });

class SourceIngestionLifecycleOrchestrator {
  private readonly machine: SourceIngestionLifecycleMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: SourceIngestionLifecycleOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): SourceIngestionLifecycleSnapshot {
    return this.machine.getSnapshot();
  }

  handle(
    domainEvent: SourceIngestionLifecycleDomainEvent,
  ): SourceIngestionLifecycleTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(
    domainEvent: SourceIngestionLifecycleDomainEvent,
  ): SourceIngestionLifecycleTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { SourceIngestionLifecycleOrchestrator };
export type {
  SourceIngestionLifecycleDomainEvent,
  SourceIngestionLifecycleOrchestratorDependencies,
};
