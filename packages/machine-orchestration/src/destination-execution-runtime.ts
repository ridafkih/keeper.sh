import {
  type CommandOutboxStore,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  RuntimeInvariantViolationError,
  MachineRuntimeDriver,
  type RuntimeProcessEvent,
  type RuntimeMachine,
} from "./machine-runtime-driver";
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
  createEnvelope: (
    event: DestinationExecutionEvent,
  ) => EventEnvelope<DestinationExecutionEvent>;
  handlers: DestinationExecutionCommandHandlers;
  outboxStore: CommandOutboxStore<DestinationExecutionCommand>;
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
  dispatch: (event: DestinationExecutionEvent) => Promise<DestinationExecutionDispatchResult>;
  releaseIfHeld: () => Promise<void>;
}

type DestinationExecutionDispatchResult =
  | {
    outcome: "TRANSITION_APPLIED";
    transition: DestinationExecutionTransitionResult;
  }
  | {
    outcome: "DUPLICATE_IGNORED";
  }
  | {
    outcome: "CONFLICT_DETECTED";
    aggregateId: string;
    envelopeId: string;
  };

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
    outboxStore: input.outboxStore,
    eventSink: {
      onProcessed: (event) => input.onRuntimeEvent(event),
    },
    machine,
    snapshotStore,
  });

  const dispatch = async (
    event: DestinationExecutionEvent,
  ): Promise<DestinationExecutionDispatchResult> => {
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
    const envelope = input.createEnvelope(event);
    if (!envelope.id) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.calendarId,
        code: "DESTINATION_EXECUTION_ENVELOPE_ID_REQUIRED",
        reason: "envelope id is required",
        surface: "destination-execution-runtime",
      });
    }
    if (!envelope.occurredAt || Number.isNaN(Date.parse(envelope.occurredAt))) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.calendarId,
        code: "DESTINATION_EXECUTION_ENVELOPE_OCCURRED_AT_INVALID",
        reason: "envelope occurredAt is invalid",
        surface: "destination-execution-runtime",
      });
    }
    const result = await driver.process(envelope);
    if (result.outcome === "CONFLICT_DETECTED") {
      return {
        outcome: "CONFLICT_DETECTED",
        aggregateId: input.calendarId,
        envelopeId: envelope.id,
      };
    }
    if (result.outcome === "DUPLICATE_IGNORED") {
      return {
        outcome: "DUPLICATE_IGNORED",
      };
    }
    if (!result.transition) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.calendarId,
        code: "DESTINATION_EXECUTION_TRANSITION_MISSING",
        reason: "runtime process returned applied outcome without transition",
        surface: "destination-execution-runtime",
      });
    }
    await driver.drainOutbox();
    return {
      outcome: "TRANSITION_APPLIED",
      transition: result.transition,
    };
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
  DestinationExecutionDispatchResult,
  DestinationExecutionCommandHandlers,
  DestinationExecutionRuntimeEvent,
  DestinationExecutionRuntime,
  DestinationExecutionRuntimeInput,
};
