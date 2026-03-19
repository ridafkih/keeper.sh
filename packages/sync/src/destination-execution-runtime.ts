import {
  type RuntimeProcessEvent,
  type RuntimeMachine,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
  DestinationExecutionCommandType,
  DestinationExecutionEventType,
  DestinationExecutionStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  DestinationExecutionCommand,
  DestinationExecutionContext,
  DestinationExecutionEvent,
  DestinationExecutionOutput,
  DestinationExecutionState,
  DestinationExecutionTransitionResult,
  EventEnvelope,
  MachineSnapshot,
} from "@keeper.sh/state-machines";

interface DestinationExecutionCommandHandlers {
  releaseLock: (holderId: string) => Promise<void>;
  applyBackoff: (nextAttemptAt: string) => Promise<void>;
  disableDestination: (reason: string) => Promise<void>;
  emitSyncEvent: (eventsAdded: number, eventsRemoved: number) => Promise<void>;
}

interface DestinationExecutionRuntimeInput {
  calendarId: string;
  failureCount: number;
  handlers: DestinationExecutionCommandHandlers;
  onRuntimeEvent: (
    event: RuntimeProcessEvent<
      DestinationExecutionState,
      DestinationExecutionContext,
      DestinationExecutionEvent,
      DestinationExecutionCommand,
      DestinationExecutionOutput
    >,
  ) => Promise<void> | void;
}

interface DestinationExecutionRuntime {
  dispatch: (event: DestinationExecutionEvent) => Promise<DestinationExecutionTransitionResult>;
  releaseIfHeld: () => Promise<void>;
}

type DestinationExecutionRuntimeEvent = RuntimeProcessEvent<
  DestinationExecutionState,
  DestinationExecutionContext,
  DestinationExecutionEvent,
  DestinationExecutionCommand,
  DestinationExecutionOutput
>;

class RestorableDestinationExecutionStateMachine
  extends DestinationExecutionStateMachine
  implements RuntimeMachine<
    DestinationExecutionState,
    DestinationExecutionContext,
    DestinationExecutionEvent,
    DestinationExecutionCommand,
    DestinationExecutionOutput
  >
{
  restore(snapshot: MachineSnapshot<DestinationExecutionState, DestinationExecutionContext>): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const createDestinationExecutionRuntime = (
  input: DestinationExecutionRuntimeInput,
): DestinationExecutionRuntime => {
  let envelopeSequence = 0;
  let initialized = false;
  let released = false;
  let currentHolderId: string | null = null;
  const snapshotStore = new InMemorySnapshotStore<
    DestinationExecutionState,
    DestinationExecutionContext
  >();
  const envelopeStore = new InMemoryEnvelopeStore();

  const machine = new RestorableDestinationExecutionStateMachine(
    { calendarId: input.calendarId, failureCount: input.failureCount },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );

  const driver = new MachineRuntimeDriver<
    DestinationExecutionState,
    DestinationExecutionContext,
    DestinationExecutionEvent,
    DestinationExecutionCommand,
    DestinationExecutionOutput
  >({
    aggregateId: input.calendarId,
    commandBus: {
      execute: async (command) => {
        switch (command.type) {
          case DestinationExecutionCommandType.RELEASE_LOCK: {
            released = true;
            await input.handlers.releaseLock(command.holderId);
            return;
          }
          case DestinationExecutionCommandType.APPLY_BACKOFF: {
            await input.handlers.applyBackoff(command.nextAttemptAt);
            return;
          }
          case DestinationExecutionCommandType.DISABLE_DESTINATION: {
            await input.handlers.disableDestination(command.reason);
            return;
          }
          case DestinationExecutionCommandType.EMIT_SYNC_EVENT: {
            await input.handlers.emitSyncEvent(command.eventsAdded, command.eventsRemoved);
            return;
          }
          default: {
            throw new Error("Unhandled destination execution command");
          }
        }
      },
    },
    envelopeStore,
    eventSink: {
      onProcessed: (event) => input.onRuntimeEvent(event),
    },
    machine,
    snapshotStore,
  });

  const dispatch = async (
    event: DestinationExecutionEvent,
  ): Promise<DestinationExecutionTransitionResult> => {
    if (!initialized) {
      await snapshotStore.initialize(input.calendarId, {
        context: {
          calendarId: input.calendarId,
          failureCount: input.failureCount,
        },
        state: "ready",
      });
      initialized = true;
    }
    if (
      event.type === DestinationExecutionEventType.LOCK_ACQUIRED
      || event.type === DestinationExecutionEventType.LOCK_WAIT_STARTED
    ) {
      currentHolderId = event.holderId;
    }
    envelopeSequence += 1;
    const envelope: EventEnvelope<DestinationExecutionEvent> = {
      actor: { id: "sync-runtime", type: "system" },
      event,
      id: `${input.calendarId}:${envelopeSequence}:${event.type}`,
      occurredAt: new Date().toISOString(),
    };
    const result = await driver.process(envelope);
    if (!result.transition) {
      throw new Error("Invariant violated: destination execution transition missing");
    }
    return result.transition;
  };

  const releaseIfHeld = async (): Promise<void> => {
    if (released || !currentHolderId) {
      return;
    }
    await input.handlers.releaseLock(currentHolderId);
    released = true;
  };

  return { dispatch, releaseIfHeld };
};

export { createDestinationExecutionRuntime };
export type {
  DestinationExecutionCommandHandlers,
  DestinationExecutionRuntimeEvent,
  DestinationExecutionRuntime,
  DestinationExecutionRuntimeInput,
};
