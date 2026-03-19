import {
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
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
}

interface SourceIngestionLifecycleRuntime {
  dispatch: (
    event: SourceIngestionLifecycleEvent,
  ) => Promise<SourceIngestionLifecycleTransitionResult>;
}

interface SourceIngestionLifecycleMachine {
  restore: (
    snapshot: MachineSnapshot<SourceIngestionLifecycleState, SourceIngestionLifecycleContext>,
  ) => void;
  dispatch: (
    envelope: EventEnvelope<SourceIngestionLifecycleEvent>,
  ) => SourceIngestionLifecycleTransitionResult;
}

class RestorableSourceIngestionLifecycleStateMachine
  extends SourceIngestionLifecycleStateMachine
  implements SourceIngestionLifecycleMachine
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
        if (command.type === "MARK_NEEDS_REAUTH") {
          await input.handlers.markNeedsReauth();
          return;
        }
        if (command.type === "DISABLE_SOURCE") {
          await input.handlers.disableSource();
          return;
        }
        if (command.type === "PERSIST_SYNC_TOKEN") {
          await input.handlers.persistSyncToken(command.syncToken);
          return;
        }
        throw new Error("Unhandled source ingestion command");
      },
    },
    envelopeStore,
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
    if (!result.transition) {
      throw new Error("Invariant violated: source ingestion transition missing");
    }
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
