import type {
  EventActor,
  PushJobArbitrationEvent,
  PushJobArbitrationMachine,
  PushJobArbitrationSnapshot,
  PushJobArbitrationTransitionResult,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type PushJobArbitrationDomainEvent =
  | { type: "JOB_ACTIVATED"; actorId: string; jobId: string }
  | { type: "JOB_COMPLETED"; actorId: string; jobId: string }
  | { type: "JOB_FAILED"; actorId: string; jobId: string }
  | { type: "JOB_CANCELLED"; actorId: string; jobId: string };

interface PushJobArbitrationOrchestratorDependencies {
  machine: PushJobArbitrationMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: PushJobArbitrationDomainEvent,
): PushJobArbitrationEvent => ({
  type: domainEvent.type,
  jobId: domainEvent.jobId,
});

const mapDomainActor = (domainEvent: PushJobArbitrationDomainEvent): EventActor => ({ type: "worker", id: domainEvent.actorId });

class PushJobArbitrationOrchestrator {
  private readonly machine: PushJobArbitrationMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: PushJobArbitrationOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): PushJobArbitrationSnapshot {
    return this.machine.getSnapshot();
  }

  handle(
    domainEvent: PushJobArbitrationDomainEvent,
  ): PushJobArbitrationTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(
    domainEvent: PushJobArbitrationDomainEvent,
  ): PushJobArbitrationTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { PushJobArbitrationOrchestrator };
export type {
  PushJobArbitrationDomainEvent,
  PushJobArbitrationOrchestratorDependencies,
};
