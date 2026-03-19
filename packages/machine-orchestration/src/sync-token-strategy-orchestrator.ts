import type {
  EventActor,
  SyncTokenStrategyEvent,
  SyncTokenStrategyMachine,
  SyncTokenStrategySnapshot,
  SyncTokenStrategyTransitionResult,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type SyncTokenStrategyDomainEvent =
  | { type: "TOKEN_LOADED"; actorId: string; token: string | null; loadedWindowVersion?: number }
  | { type: "DELTA_SYNC_REQUESTED"; actorId: string }
  | { type: "FULL_SYNC_REQUIRED"; actorId: string }
  | { type: "TOKEN_INVALIDATED"; actorId: string }
  | { type: "NEXT_TOKEN_RECEIVED"; actorId: string; token: string };

interface SyncTokenStrategyOrchestratorDependencies {
  machine: SyncTokenStrategyMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: SyncTokenStrategyDomainEvent,
): SyncTokenStrategyEvent => {
  if (domainEvent.type === "TOKEN_LOADED") {
    return {
      type: "TOKEN_LOADED",
      token: domainEvent.token,
      loadedWindowVersion: domainEvent.loadedWindowVersion,
    };
  }
  if (domainEvent.type === "NEXT_TOKEN_RECEIVED") {
    return { type: "NEXT_TOKEN_RECEIVED", token: domainEvent.token };
  }
  return { type: domainEvent.type };
};

const mapDomainActor = (domainEvent: SyncTokenStrategyDomainEvent): EventActor => ({ type: "system", id: domainEvent.actorId });

class SyncTokenStrategyOrchestrator {
  private readonly machine: SyncTokenStrategyMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: SyncTokenStrategyOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): SyncTokenStrategySnapshot {
    return this.machine.getSnapshot();
  }

  handle(
    domainEvent: SyncTokenStrategyDomainEvent,
  ): SyncTokenStrategyTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(domainEvent: SyncTokenStrategyDomainEvent): SyncTokenStrategyTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { SyncTokenStrategyOrchestrator };
export type {
  SyncTokenStrategyDomainEvent,
  SyncTokenStrategyOrchestratorDependencies,
};
