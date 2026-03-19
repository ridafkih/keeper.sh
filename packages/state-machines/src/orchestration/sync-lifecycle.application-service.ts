import type { EventEnvelope } from "../core/event-envelope";
import { SyncLifecycleStateMachine } from "../sync-lifecycle.machine";
import type { SyncLifecycleEvent, SyncLifecycleMachine } from "../sync-lifecycle.machine";

interface JobCoordinator {
  requestEnqueueIdempotent: (userId: string, idempotencyKey: string) => void;
}

interface SyncLifecycleBroadcaster {
  publishSyncAggregateUpdate: (userId: string) => void;
}

interface SyncLifecycleApplicationServiceDependencies {
  userId: string;
  jobCoordinator: JobCoordinator;
  broadcaster: SyncLifecycleBroadcaster;
  machine?: SyncLifecycleMachine;
}

class SyncLifecycleApplicationService {
  private readonly userId: string;
  private readonly jobCoordinator: JobCoordinator;
  private readonly broadcaster: SyncLifecycleBroadcaster;
  private readonly machine: SyncLifecycleMachine;

  constructor(dependencies: SyncLifecycleApplicationServiceDependencies) {
    this.userId = dependencies.userId;
    this.jobCoordinator = dependencies.jobCoordinator;
    this.broadcaster = dependencies.broadcaster;
    this.machine = dependencies.machine ?? new SyncLifecycleStateMachine();
  }

  handle(envelope: EventEnvelope<SyncLifecycleEvent>): void {
    const result = this.machine.dispatch(envelope);

    for (const command of result.commands) {
      if (command.type === "REQUEST_PUSH_SYNC_ENQUEUE") {
        this.jobCoordinator.requestEnqueueIdempotent(
          this.userId,
          this.resolveEnqueueIdempotencyKey(result.state, result.context.pendingReasons),
        );
      }

      if (command.type === "BROADCAST_AGGREGATE") {
        this.broadcaster.publishSyncAggregateUpdate(this.userId);
      }
    }
  }

  private resolveEnqueueIdempotencyKey(
    state: string,
    pendingReasons: Set<string>,
  ): string {
    const reasons = [...pendingReasons].toSorted().join(",");
    return `sync:${this.userId}:${state}:${reasons}`;
  }
}

export { SyncLifecycleApplicationService };
export type {
  JobCoordinator,
  SyncLifecycleBroadcaster,
  SyncLifecycleApplicationServiceDependencies,
};
