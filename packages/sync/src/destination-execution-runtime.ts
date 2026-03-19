import {
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineRuntimeDriver,
} from "@keeper.sh/machine-orchestration";
import {
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
}

interface DestinationExecutionRuntime {
  dispatch: (event: DestinationExecutionEvent) => Promise<DestinationExecutionTransitionResult>;
  releaseIfHeld: () => Promise<void>;
}

interface DestinationExecutionMachine {
  restore: (
    snapshot: MachineSnapshot<DestinationExecutionState, DestinationExecutionContext>,
  ) => void;
  dispatch: (
    envelope: EventEnvelope<DestinationExecutionEvent>,
  ) => DestinationExecutionTransitionResult;
}

class RestorableDestinationExecutionStateMachine
  extends DestinationExecutionStateMachine
  implements DestinationExecutionMachine
{
  restore(snapshot: MachineSnapshot<DestinationExecutionState, DestinationExecutionContext>): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const snapshotStore = new InMemorySnapshotStore<
  DestinationExecutionState,
  DestinationExecutionContext
>();
const envelopeStore = new InMemoryEnvelopeStore();

const createDestinationExecutionRuntime = (
  input: DestinationExecutionRuntimeInput,
): DestinationExecutionRuntime => {
  let envelopeSequence = 0;
  let initialized = false;
  let released = false;
  let currentHolderId: string | null = null;

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
        if (command.type === "RELEASE_LOCK") {
          released = true;
          await input.handlers.releaseLock(command.holderId);
          return;
        }
        if (command.type === "APPLY_BACKOFF") {
          await input.handlers.applyBackoff(command.nextAttemptAt);
          return;
        }
        if (command.type === "DISABLE_DESTINATION") {
          await input.handlers.disableDestination(command.reason);
          return;
        }
        if (command.type === "EMIT_SYNC_EVENT") {
          await input.handlers.emitSyncEvent(command.eventsAdded, command.eventsRemoved);
          return;
        }
        throw new Error("Unhandled destination execution command");
      },
    },
    envelopeStore,
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
    if (event.type === "LOCK_ACQUIRED" || event.type === "LOCK_WAIT_STARTED") {
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
  DestinationExecutionRuntime,
  DestinationExecutionRuntimeInput,
};
