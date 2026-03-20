import {
  type CommandBus,
  InMemoryCommandOutboxStore,
  MachineConflictDetectedError,
  type RuntimeProcessEvent,
  type RuntimeMachine,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
  PushJobArbitrationCommandType,
  PushJobArbitrationEventType,
  PushJobArbitrationStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  EventEnvelope,
  MachineSnapshot,
  PushJobArbitrationCommand,
  PushJobArbitrationContext,
  PushJobArbitrationEvent,
  PushJobArbitrationOutput,
  PushJobArbitrationState,
} from "@keeper.sh/state-machines";

interface WorkerQueueControlPort {
  cancelJob: (jobId: string, reason: string) => Promise<unknown> | unknown;
}

interface SyncingAggregatePort {
  holdSyncing: (userId: string) => Promise<void> | void;
  releaseSyncing: (userId: string) => Promise<void> | void;
}

interface PushJobArbitrationRuntimeDependencies {
  worker: WorkerQueueControlPort;
  syncing: SyncingAggregatePort;
  onRuntimeEvent: (
    event: RuntimeProcessEvent<
      PushJobArbitrationState,
      PushJobArbitrationContext,
      PushJobArbitrationEvent,
      PushJobArbitrationCommand,
      PushJobArbitrationOutput
    >,
  ) => Promise<void> | void;
}

interface PushJobArbitrationRuntime {
  onJobActive: (input: { userId: string; jobId: string }) => Promise<void>;
  onJobCompleted: (input: { userId: string; jobId: string }) => Promise<void>;
  onJobFailed: (input: { userId: string; jobId: string }) => Promise<void>;
}

const SUPERSEDED_REASON = "superseded by newer sync";

class RestorablePushJobArbitrationStateMachine
  extends PushJobArbitrationStateMachine
  implements RuntimeMachine<
    PushJobArbitrationState,
    PushJobArbitrationContext,
    PushJobArbitrationEvent,
    PushJobArbitrationCommand,
    PushJobArbitrationOutput
  >
{
  restore(snapshot: MachineSnapshot<PushJobArbitrationState, PushJobArbitrationContext>): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const snapshotStore = new InMemorySnapshotStore<
  PushJobArbitrationState,
  PushJobArbitrationContext
>();
const envelopeStore = new InMemoryEnvelopeStore();
const outboxStore = new InMemoryCommandOutboxStore<PushJobArbitrationCommand>();

const buildEnvelope = (
  event: PushJobArbitrationEvent,
  jobId: string,
): EventEnvelope<PushJobArbitrationEvent> => ({
  actor: { id: "worker-bullmq", type: "system" },
  event,
  id: `${event.type}:${jobId}`,
  occurredAt: new Date().toISOString(),
});

const createCommandBus = (
  dependencies: PushJobArbitrationRuntimeDependencies,
  userId: string,
): CommandBus<PushJobArbitrationCommand> => ({
  execute: async (command) => {
    switch (command.type) {
      case PushJobArbitrationCommandType.CANCEL_JOB: {
        await dependencies.worker.cancelJob(command.jobId, SUPERSEDED_REASON);
        return;
      }
      case PushJobArbitrationCommandType.HOLD_SYNCING: {
        await dependencies.syncing.holdSyncing(userId);
        return;
      }
      case PushJobArbitrationCommandType.RELEASE_SYNCING: {
        await dependencies.syncing.releaseSyncing(userId);
        return;
      }
      default: {
        throw new Error("Unhandled push arbitration command");
      }
    }
  },
});

const dispatch = async (
  dependencies: PushJobArbitrationRuntimeDependencies,
  userId: string,
  jobId: string,
  event: PushJobArbitrationEvent,
): Promise<void> => {
  await snapshotStore.initializeIfMissing(userId, { context: {}, state: "idle" });

  const machine = new RestorablePushJobArbitrationStateMachine({
    transitionPolicy: TransitionPolicy.IGNORE,
  });
  const driver = new MachineRuntimeDriver<
    PushJobArbitrationState,
    PushJobArbitrationContext,
    PushJobArbitrationEvent,
    PushJobArbitrationCommand,
    PushJobArbitrationOutput
  >({
    aggregateId: userId,
    commandBus: createCommandBus(dependencies, userId),
    envelopeStore,
    outboxStore,
    eventSink: {
      onProcessed: (processedEvent) => dependencies.onRuntimeEvent(processedEvent),
    },
    machine,
    snapshotStore,
  });

  const envelope = buildEnvelope(event, jobId);
  const result = await driver.process(envelope);
  if (result.outcome === "APPLIED" || result.outcome === "DUPLICATE_IGNORED") {
    await driver.drainOutbox();
    return;
  }
  throw new MachineConflictDetectedError(userId, envelope.id);
};

const createPushJobArbitrationRuntime = (
  dependencies: PushJobArbitrationRuntimeDependencies,
): PushJobArbitrationRuntime => {
  const queuesByUserId = new Map<string, Promise<void>>();

  const enqueueForUser = (userId: string, action: () => Promise<void>): Promise<void> => {
    const previous = queuesByUserId.get(userId) ?? Promise.resolve();
    const next = previous.then(action, action);
    queuesByUserId.set(userId, next);
    return next.finally(() => {
      if (queuesByUserId.get(userId) === next) {
        queuesByUserId.delete(userId);
      }
    });
  };

  return {
    onJobActive: ({ jobId, userId }) =>
      enqueueForUser(userId, () =>
        dispatch(dependencies, userId, jobId, { jobId, type: PushJobArbitrationEventType.JOB_ACTIVATED })),
    onJobCompleted: ({ jobId, userId }) =>
      enqueueForUser(userId, () =>
        dispatch(dependencies, userId, jobId, { jobId, type: PushJobArbitrationEventType.JOB_COMPLETED })),
    onJobFailed: ({ jobId, userId }) =>
      enqueueForUser(userId, () =>
        dispatch(dependencies, userId, jobId, { jobId, type: PushJobArbitrationEventType.JOB_FAILED })),
  };
};

export { SUPERSEDED_REASON, createPushJobArbitrationRuntime };
export type {
  PushJobArbitrationRuntime,
  PushJobArbitrationRuntimeDependencies,
  SyncingAggregatePort,
  WorkerQueueControlPort,
};
