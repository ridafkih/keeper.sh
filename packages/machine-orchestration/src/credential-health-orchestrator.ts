import type {
  CredentialHealthEvent,
  CredentialHealthMachine,
  CredentialHealthSnapshot,
  CredentialHealthTransitionResult,
  EventActor,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type CredentialHealthDomainEvent =
  | { type: "TOKEN_EXPIRY_DETECTED"; actorId: string }
  | { type: "REFRESH_STARTED"; actorId: string }
  | { type: "REFRESH_SUCCEEDED"; actorId: string; newExpiresAt: string }
  | { type: "REFRESH_REAUTH_REQUIRED"; actorId: string; code: string }
  | { type: "REFRESH_RETRYABLE_FAILED"; actorId: string; code: string };

interface CredentialHealthOrchestratorDependencies {
  machine: CredentialHealthMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: CredentialHealthDomainEvent,
): CredentialHealthEvent => {
  if (domainEvent.type === "REFRESH_SUCCEEDED") {
    return { type: "REFRESH_SUCCEEDED", newExpiresAt: domainEvent.newExpiresAt };
  }
  if (
    domainEvent.type === "REFRESH_REAUTH_REQUIRED"
    || domainEvent.type === "REFRESH_RETRYABLE_FAILED"
  ) {
    return { type: domainEvent.type, code: domainEvent.code };
  }
  return { type: domainEvent.type };
};

const mapDomainActor = (domainEvent: CredentialHealthDomainEvent): EventActor => ({ type: "worker", id: domainEvent.actorId });

class CredentialHealthOrchestrator {
  private readonly machine: CredentialHealthMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: CredentialHealthOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): CredentialHealthSnapshot {
    return this.machine.getSnapshot();
  }

  handle(domainEvent: CredentialHealthDomainEvent): CredentialHealthTransitionResult {
    return this.handleTransition(domainEvent);
  }

  handleTransition(domainEvent: CredentialHealthDomainEvent): CredentialHealthTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { CredentialHealthOrchestrator };
export type {
  CredentialHealthDomainEvent,
  CredentialHealthOrchestratorDependencies,
};
