import {
  type CommandOutboxStore,
  MachineConflictDetectedError,
  type RuntimeProcessEvent,
  type RuntimeMachine,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
  SourceIngestionLifecycleCommandType,
  SourceIngestionLifecycleStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  EventEnvelope,
  MachineSnapshot,
  SourceIngestionLifecycleCommand,
  SourceIngestionLifecycleContext,
  SourceIngestionLifecycleEvent,
  SourceIngestionLifecycleOutput,
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleTransitionResult,
} from "@keeper.sh/state-machines";

interface SourceIngestionLifecycleCommandHandlers {
  markNeedsReauth: () => Promise<void>;
  disableSource: () => Promise<void>;
  persistSyncToken: (syncToken: string) => Promise<void>;
}

interface SourceIngestionLifecycleRuntimeInput {
  sourceId: string;
  provider: string;
  handlers: SourceIngestionLifecycleCommandHandlers;
  outboxStore: CommandOutboxStore<SourceIngestionLifecycleCommand>;
  onRuntimeEvent: (
    event: RuntimeProcessEvent<
      SourceIngestionLifecycleState,
      SourceIngestionLifecycleContext,
      SourceIngestionLifecycleEvent,
      SourceIngestionLifecycleCommand,
      SourceIngestionLifecycleOutput
    >,
  ) => Promise<void> | void;
}

interface SourceIngestionLifecycleRuntime {
  dispatch: (
    event: SourceIngestionLifecycleEvent,
  ) => Promise<SourceIngestionLifecycleTransitionResult>;
}

class RestorableSourceIngestionLifecycleStateMachine
  extends SourceIngestionLifecycleStateMachine
  implements RuntimeMachine<
    SourceIngestionLifecycleState,
    SourceIngestionLifecycleContext,
    SourceIngestionLifecycleEvent,
    SourceIngestionLifecycleCommand,
    SourceIngestionLifecycleOutput
  >
{
  restore(
    snapshot: MachineSnapshot<SourceIngestionLifecycleState, SourceIngestionLifecycleContext>,
  ): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const createSourceIngestionLifecycleRuntime = (
  input: SourceIngestionLifecycleRuntimeInput,
): SourceIngestionLifecycleRuntime => {
  let envelopeSequence = 0;
  const snapshotStore = new InMemorySnapshotStore<
    SourceIngestionLifecycleState,
    SourceIngestionLifecycleContext
  >();
  const envelopeStore = new InMemoryEnvelopeStore();
  const machine = new RestorableSourceIngestionLifecycleStateMachine(
    { provider: input.provider, sourceId: input.sourceId },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );
  const driver = new MachineRuntimeDriver<
    SourceIngestionLifecycleState,
    SourceIngestionLifecycleContext,
    SourceIngestionLifecycleEvent,
    SourceIngestionLifecycleCommand,
    SourceIngestionLifecycleOutput
  >({
    aggregateId: input.sourceId,
    commandBus: {
      execute: async (command) => {
        switch (command.type) {
          case SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH: {
            await input.handlers.markNeedsReauth();
            return;
          }
          case SourceIngestionLifecycleCommandType.DISABLE_SOURCE: {
            await input.handlers.disableSource();
            return;
          }
          case SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN: {
            await input.handlers.persistSyncToken(command.syncToken);
            return;
          }
          default: {
            throw new Error("Unhandled source ingestion command");
          }
        }
      },
    },
    envelopeStore,
    outboxStore: input.outboxStore,
    eventSink: {
      onProcessed: (event) => input.onRuntimeEvent(event),
    },
    machine,
    snapshotStore,
  });

  const dispatch = async (
    event: SourceIngestionLifecycleEvent,
  ): Promise<SourceIngestionLifecycleTransitionResult> => {
    if (envelopeSequence === 0) {
      await snapshotStore.initialize(input.sourceId, {
        context: {
          eventsAdded: 0,
          eventsRemoved: 0,
          provider: input.provider,
          sourceId: input.sourceId,
        },
        state: "source_selected",
      });
    }
    envelopeSequence += 1;
    const envelope: EventEnvelope<SourceIngestionLifecycleEvent> = {
      actor: { id: "cron-ingest", type: "system" },
      event,
      id: `${input.sourceId}:${envelopeSequence}:${event.type}`,
      occurredAt: new Date().toISOString(),
    };
    const result = await driver.process(envelope);
    if (result.outcome === "CONFLICT_DETECTED") {
      throw new MachineConflictDetectedError(input.sourceId, envelope.id);
    }
    if (!result.transition) {
      throw new Error("Invariant violated: source ingestion transition missing");
    }
    await driver.drainOutbox();
    return result.transition;
  };

  return { dispatch };
};

export { createSourceIngestionLifecycleRuntime };
export type {
  SourceIngestionLifecycleCommandHandlers,
  SourceIngestionLifecycleRuntime,
  SourceIngestionLifecycleRuntimeInput,
};
