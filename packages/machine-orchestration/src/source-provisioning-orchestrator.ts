import type {
  EventActor,
  SourceProvisioningEvent,
  SourceProvisioningMachine,
  SourceProvisioningSnapshot,
  SourceProvisioningTransitionResult,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type SourceProvisioningDomainEvent =
  | { type: "REQUEST_VALIDATED"; actorId: string }
  | {
      type: "REQUEST_REJECTED";
      actorId: string;
      reason: "invalid_source" | "ownership" | "provider_mismatch";
    }
  | { type: "QUOTA_GRANTED"; actorId: string }
  | { type: "QUOTA_EXCEEDED"; actorId: string }
  | { type: "DEDUPLICATION_PASSED"; actorId: string }
  | { type: "DUPLICATE_DETECTED"; actorId: string }
  | { type: "ACCOUNT_REUSED"; actorId: string; accountId: string }
  | { type: "ACCOUNT_CREATED"; actorId: string; accountId: string }
  | { type: "SOURCE_CREATED"; actorId: string; sourceIds: string[] }
  | { type: "BOOTSTRAP_SYNC_TRIGGERED"; actorId: string; mode: "create_single" | "import_bulk"; sourceIds: string[] };

interface SourceProvisioningOrchestratorDependencies {
  machine: SourceProvisioningMachine;
  envelopeFactory: EnvelopeFactory;
}

const mapDomainEventToMachineEvent = (
  domainEvent: SourceProvisioningDomainEvent,
): SourceProvisioningEvent => {
  if (domainEvent.type === "REQUEST_VALIDATED") {
    return { type: "VALIDATION_PASSED" };
  }
  if (domainEvent.type === "REQUEST_REJECTED") {
    return { type: "VALIDATION_FAILED", reason: domainEvent.reason };
  }
  if (domainEvent.type === "QUOTA_GRANTED") {
    return { type: "QUOTA_ALLOWED" };
  }
  if (domainEvent.type === "QUOTA_EXCEEDED") {
    return { type: "QUOTA_DENIED" };
  }
  if (domainEvent.type === "DEDUPLICATION_PASSED") {
    return { type: "DEDUPLICATION_PASSED" };
  }
  if (domainEvent.type === "DUPLICATE_DETECTED") {
    return { type: "DUPLICATE_DETECTED" };
  }
  if (domainEvent.type === "ACCOUNT_REUSED") {
    return { type: "ACCOUNT_REUSED", accountId: domainEvent.accountId };
  }
  if (domainEvent.type === "ACCOUNT_CREATED") {
    return { type: "ACCOUNT_CREATED", accountId: domainEvent.accountId };
  }
  if (domainEvent.type === "SOURCE_CREATED") {
    return { type: "SOURCE_CREATED", sourceIds: domainEvent.sourceIds };
  }
  return {
    type: "BOOTSTRAP_SYNC_TRIGGERED",
    mode: domainEvent.mode,
    sourceIds: domainEvent.sourceIds,
  };
};

const mapDomainActor = (domainEvent: SourceProvisioningDomainEvent): EventActor => {
  if (
    domainEvent.type === "REQUEST_VALIDATED"
    || domainEvent.type === "REQUEST_REJECTED"
  ) {
    return { type: "user", id: domainEvent.actorId };
  }

  return { type: "system", id: domainEvent.actorId };
};

class SourceProvisioningOrchestrator {
  private readonly machine: SourceProvisioningMachine;
  private readonly envelopeFactory: EnvelopeFactory;

  constructor(dependencies: SourceProvisioningOrchestratorDependencies) {
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
  }

  getSnapshot(): SourceProvisioningSnapshot {
    return this.machine.getSnapshot();
  }

  handle(domainEvent: SourceProvisioningDomainEvent): SourceProvisioningSnapshot {
    return this.handleTransition(domainEvent);
  }

  handleTransition(domainEvent: SourceProvisioningDomainEvent): SourceProvisioningTransitionResult {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    return this.machine.dispatch(envelope);
  }
}

export { SourceProvisioningOrchestrator };
export type {
  SourceProvisioningDomainEvent,
  SourceProvisioningOrchestratorDependencies,
};
