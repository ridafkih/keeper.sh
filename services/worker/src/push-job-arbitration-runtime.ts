import {
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
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
  PushJobArbitrationTransitionResult,
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
}

interface PushJobArbitrationRuntime {
  onJobActive: (input: { userId: string; jobId: string }) => Promise<void>;
  onJobCompleted: (input: { userId: string; jobId: string }) => Promise<void>;
  onJobFailed: (input: { userId: string; jobId: string }) => Promise<void>;
}

interface PushArbitrationMachine {
  restore: (
    snapshot: MachineSnapshot<PushJobArbitrationState, PushJobArbitrationContext>,
  ) => void;
  dispatch: (
    envelope: EventEnvelope<PushJobArbitrationEvent>,
  ) => PushJobArbitrationTransitionResult;
}

const SUPERSEDED_REASON = "superseded by newer sync";

class RestorablePushJobArbitrationStateMachine
  extends PushJobArbitrationStateMachine
  implements PushArbitrationMachine
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
): {
  execute: (command: PushJobArbitrationCommand) => Promise<void>;
} => ({
  execute: async (command) => {
    if (command.type === "CANCEL_JOB") {
      await dependencies.worker.cancelJob(command.jobId, SUPERSEDED_REASON);
      return;
    }
    if (command.type === "HOLD_SYNCING") {
      await dependencies.syncing.holdSyncing(userId);
      return;
    }
    if (command.type === "RELEASE_SYNCING") {
      await dependencies.syncing.releaseSyncing(userId);
      return;
    }
    throw new Error("Unhandled push arbitration command");
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
    machine,
    snapshotStore,
  });

  const envelope = buildEnvelope(event, jobId);
  await driver.process(envelope);
};

const createPushJobArbitrationRuntime = (
  dependencies: PushJobArbitrationRuntimeDependencies,
): PushJobArbitrationRuntime => ({
  onJobActive: async ({ jobId, userId }) => {
    await dispatch(dependencies, userId, jobId, { jobId, type: "JOB_ACTIVATED" });
  },
  onJobCompleted: async ({ jobId, userId }) => {
    await dispatch(dependencies, userId, jobId, { jobId, type: "JOB_COMPLETED" });
  },
  onJobFailed: async ({ jobId, userId }) => {
    await dispatch(dependencies, userId, jobId, { jobId, type: "JOB_FAILED" });
  },
});

export { SUPERSEDED_REASON, createPushJobArbitrationRuntime };
export type {
  PushJobArbitrationRuntime,
  PushJobArbitrationRuntimeDependencies,
  SyncingAggregatePort,
  WorkerQueueControlPort,
};
