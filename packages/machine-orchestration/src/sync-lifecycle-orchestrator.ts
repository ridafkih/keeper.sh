import type {
  ErrorPolicy,
  EventActor,
  SyncLifecycleEvent,
  SyncLifecycleMachine,
  SyncLifecycleSnapshot,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";

type SyncLifecycleDomainEvent =
  | { type: "CONTENT_CHANGED"; actorId: string }
  | { type: "SYNC_REQUESTED"; actorId: string }
  | { type: "JOB_STARTED"; actorId: string; jobId: string }
  | { type: "JOB_COMPLETED"; actorId: string; jobId: string }
  | { type: "JOB_FAILED"; actorId: string; jobId: string; code: string; policy: ErrorPolicy };

interface SyncLifecycleJobCoordinatorPort {
  requestEnqueueIdempotent: (userId: string, idempotencyKey: string) => void;
}

interface SyncLifecycleBroadcastPort {
  publishLifecycleUpdate: (userId: string) => void;
}

interface SyncLifecycleOrchestratorDependencies {
  userId: string;
  machine: SyncLifecycleMachine;
  envelopeFactory: EnvelopeFactory;
  jobCoordinator: SyncLifecycleJobCoordinatorPort;
  broadcaster: SyncLifecycleBroadcastPort;
}

const resolveIdempotencyKey = (
  userId: string,
  state: string,
  pendingReasons: Set<string>,
): string => {
  const reasons = [...pendingReasons].toSorted().join(",");
  return `sync:${userId}:${state}:${reasons}`;
};

const mapDomainEventToMachineEvent = (domainEvent: SyncLifecycleDomainEvent): SyncLifecycleEvent => {
  if (domainEvent.type === "CONTENT_CHANGED") {
    return { type: "INGEST_CHANGED" };
  }

  if (domainEvent.type === "SYNC_REQUESTED") {
    return { type: "MANUAL_SYNC_REQUESTED" };
  }

  if (domainEvent.type === "JOB_STARTED") {
    return { type: "JOB_STARTED", jobId: domainEvent.jobId };
  }

  if (domainEvent.type === "JOB_COMPLETED") {
    return { type: "JOB_COMPLETED", jobId: domainEvent.jobId };
  }

  return {
    type: "JOB_FAILED",
    code: domainEvent.code,
    jobId: domainEvent.jobId,
    policy: domainEvent.policy,
  };
};

const mapDomainActor = (domainEvent: SyncLifecycleDomainEvent): EventActor => {
  if (domainEvent.type === "JOB_COMPLETED" || domainEvent.type === "JOB_FAILED") {
    return { type: "worker", id: domainEvent.actorId };
  }

  return { type: "system", id: domainEvent.actorId };
};

class SyncLifecycleOrchestrator {
  private readonly userId: string;
  private readonly machine: SyncLifecycleMachine;
  private readonly envelopeFactory: EnvelopeFactory;
  private readonly jobCoordinator: SyncLifecycleJobCoordinatorPort;
  private readonly broadcaster: SyncLifecycleBroadcastPort;

  constructor(dependencies: SyncLifecycleOrchestratorDependencies) {
    this.userId = dependencies.userId;
    this.machine = dependencies.machine;
    this.envelopeFactory = dependencies.envelopeFactory;
    this.jobCoordinator = dependencies.jobCoordinator;
    this.broadcaster = dependencies.broadcaster;
  }

  getSnapshot(): SyncLifecycleSnapshot {
    return this.machine.getSnapshot();
  }

  handle(domainEvent: SyncLifecycleDomainEvent): SyncLifecycleSnapshot {
    const machineEvent = mapDomainEventToMachineEvent(domainEvent);
    const actor = mapDomainActor(domainEvent);
    const envelope = this.envelopeFactory.createEnvelope(machineEvent, actor);
    const result = this.machine.dispatch(envelope);

    for (const command of result.commands) {
      if (command.type === "REQUEST_PUSH_SYNC_ENQUEUE") {
        this.jobCoordinator.requestEnqueueIdempotent(
          this.userId,
          resolveIdempotencyKey(this.userId, result.state, result.context.pendingReasons),
        );
      }

      if (command.type === "BROADCAST_AGGREGATE") {
        this.broadcaster.publishLifecycleUpdate(this.userId);
      }
    }

    return result;
  }
}

export { SyncLifecycleOrchestrator };
export type {
  SyncLifecycleBroadcastPort,
  SyncLifecycleDomainEvent,
  SyncLifecycleJobCoordinatorPort,
  SyncLifecycleOrchestratorDependencies,
};
