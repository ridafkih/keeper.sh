import type {
  EventActor,
  SourceIngestionLifecycleEventType,
  SourceIngestionLifecycleMachine,
  SourceIngestionLifecycleSnapshot,
  SourceIngestionLifecycleTransitionResult,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { mapSourceIngestionLifecycleDomainEvent } from "./source-ingestion-lifecycle-event-mapper";

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
    const machineEvent = mapSourceIngestionLifecycleDomainEvent(domainEvent);
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
