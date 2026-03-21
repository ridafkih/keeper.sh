import {
  type CommandOutboxStore,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineConflictDetectedError,
  MachineRuntimeDriver,
  RuntimeInvariantViolationError,
  type RuntimeMachine,
  type RuntimeProcessEvent,
} from "./machine-runtime-driver";
import {
  SourceDestinationMappingCommandType,
  SourceDestinationMappingEventType,
  SourceDestinationMappingStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type {
  EventEnvelope,
  MachineSnapshot,
  SourceDestinationMappingCommand,
  SourceDestinationMappingContext,
  SourceDestinationMappingEvent,
  SourceDestinationMappingOutput,
  SourceDestinationMappingState,
  SourceDestinationMappingTransitionResult,
} from "@keeper.sh/state-machines";

type SourceDestinationMappingFailureEvent = Extract<
  SourceDestinationMappingEvent,
  | { type: typeof SourceDestinationMappingEventType.INVALID_SET_REJECTED }
  | { type: typeof SourceDestinationMappingEventType.LIMIT_REJECTED }
  | { type: typeof SourceDestinationMappingEventType.PRIMARY_NOT_FOUND_REJECTED }
>;

interface SourceDestinationMappingRuntimeHandlers {
  applyUpdate: () => Promise<boolean>;
  requestSync: () => Promise<void>;
}

interface SourceDestinationMappingRuntimeInput {
  aggregateId: string;
  createEnvelope: (
    event: SourceDestinationMappingEvent,
  ) => EventEnvelope<SourceDestinationMappingEvent>;
  handlers: SourceDestinationMappingRuntimeHandlers;
  classifyFailure: (error: unknown) => SourceDestinationMappingFailureEvent | null;
  outboxStore: CommandOutboxStore<SourceDestinationMappingCommand>;
  onRuntimeEvent: (
    event: RuntimeProcessEvent<
      SourceDestinationMappingState,
      SourceDestinationMappingContext,
      SourceDestinationMappingEvent,
      SourceDestinationMappingCommand,
      SourceDestinationMappingOutput
    >,
  ) => Promise<void> | void;
}

interface SourceDestinationMappingRuntime {
  applyUpdate: () => Promise<SourceDestinationMappingTransitionResult>;
}

class RestorableSourceDestinationMappingStateMachine
  extends SourceDestinationMappingStateMachine
  implements RuntimeMachine<
    SourceDestinationMappingState,
    SourceDestinationMappingContext,
    SourceDestinationMappingEvent,
    SourceDestinationMappingCommand,
    SourceDestinationMappingOutput
  >
{
  restore(
    snapshot: MachineSnapshot<SourceDestinationMappingState, SourceDestinationMappingContext>,
  ): void {
    this.state = snapshot.state;
    this.context = snapshot.context;
  }
}

const buildNoopTransition = (
  snapshot: MachineSnapshot<SourceDestinationMappingState, SourceDestinationMappingContext>,
): SourceDestinationMappingTransitionResult => ({
  commands: [],
  context: snapshot.context,
  outputs: [],
  state: snapshot.state,
});

const createSourceDestinationMappingRuntime = (
  input: SourceDestinationMappingRuntimeInput,
): SourceDestinationMappingRuntime => {
  let initialized = false;
  const snapshotStore = new InMemorySnapshotStore<
    SourceDestinationMappingState,
    SourceDestinationMappingContext
  >();
  const envelopeStore = new InMemoryEnvelopeStore();
  const machine = new RestorableSourceDestinationMappingStateMachine(
    { aggregateId: input.aggregateId },
    { transitionPolicy: TransitionPolicy.IGNORE },
  );
  const driver = new MachineRuntimeDriver<
    SourceDestinationMappingState,
    SourceDestinationMappingContext,
    SourceDestinationMappingEvent,
    SourceDestinationMappingCommand,
    SourceDestinationMappingOutput
  >({
    aggregateId: input.aggregateId,
    commandBus: {
      execute: async (command) => {
        switch (command.type) {
          case SourceDestinationMappingCommandType.REQUEST_SYNC: {
            await input.handlers.requestSync();
            return;
          }
          default: {
            throw new Error("Unhandled source-destination mapping command");
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

  const applyUpdate = async (): Promise<SourceDestinationMappingTransitionResult> => {
    if (!initialized) {
      await snapshotStore.initialize(input.aggregateId, {
        context: {
          aggregateId: input.aggregateId,
        },
        state: "idle",
      });
      initialized = true;
    }

    let event: SourceDestinationMappingEvent;
    try {
      const changed = await input.handlers.applyUpdate();
      event = { changed, type: SourceDestinationMappingEventType.UPDATE_APPLIED };
    } catch (error) {
      const mappedFailure = input.classifyFailure(error);
      if (!mappedFailure) {
        throw error;
      }
      event = mappedFailure;
    }

    const envelope = input.createEnvelope(event);
    if (!envelope.id) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.aggregateId,
        code: "SOURCE_DESTINATION_MAPPING_ENVELOPE_ID_REQUIRED",
        reason: "envelope id is required",
        surface: "source-destination-mapping-runtime",
      });
    }
    if (!envelope.occurredAt || Number.isNaN(Date.parse(envelope.occurredAt))) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.aggregateId,
        code: "SOURCE_DESTINATION_MAPPING_ENVELOPE_OCCURRED_AT_INVALID",
        reason: "envelope occurredAt is invalid",
        surface: "source-destination-mapping-runtime",
      });
    }

    const result = await driver.process(envelope);
    if (result.outcome === "CONFLICT_DETECTED") {
      throw new MachineConflictDetectedError(input.aggregateId, envelope.id);
    }
    if (result.outcome === "DUPLICATE_IGNORED") {
      return buildNoopTransition(result.snapshot);
    }
    if (!result.transition) {
      throw new RuntimeInvariantViolationError({
        aggregateId: input.aggregateId,
        code: "SOURCE_DESTINATION_MAPPING_TRANSITION_MISSING",
        reason: "runtime process returned applied outcome without transition",
        surface: "source-destination-mapping-runtime",
      });
    }

    await driver.drainOutbox();
    return result.transition;
  };

  return { applyUpdate };
};

export { createSourceDestinationMappingRuntime };
export type {
  SourceDestinationMappingFailureEvent,
  SourceDestinationMappingRuntime,
  SourceDestinationMappingRuntimeHandlers,
  SourceDestinationMappingRuntimeInput,
};
