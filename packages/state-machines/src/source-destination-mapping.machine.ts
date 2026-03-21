import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

const SourceDestinationMappingEventType = {
  INVALID_SET_REJECTED: "INVALID_SET_REJECTED",
  LIMIT_REJECTED: "LIMIT_REJECTED",
  PRIMARY_NOT_FOUND_REJECTED: "PRIMARY_NOT_FOUND_REJECTED",
  UPDATE_APPLIED: "UPDATE_APPLIED",
} as const;

const SourceDestinationMappingCommandType = {
  REQUEST_SYNC: "REQUEST_SYNC",
} as const;

type SourceDestinationMappingState = "idle" | "completed" | "rejected";
type SourceDestinationMappingRejectionReason =
  | "invalid_set"
  | "limit"
  | "primary_not_found";

interface SourceDestinationMappingContext {
  aggregateId: string;
  changed?: boolean;
  rejectionReason?: SourceDestinationMappingRejectionReason;
}

type SourceDestinationMappingEvent =
  | { type: typeof SourceDestinationMappingEventType.UPDATE_APPLIED; changed: boolean }
  | { type: typeof SourceDestinationMappingEventType.LIMIT_REJECTED }
  | { type: typeof SourceDestinationMappingEventType.INVALID_SET_REJECTED }
  | { type: typeof SourceDestinationMappingEventType.PRIMARY_NOT_FOUND_REJECTED };

type SourceDestinationMappingCommand = {
  type: typeof SourceDestinationMappingCommandType.REQUEST_SYNC;
};

type SourceDestinationMappingOutput =
  | { type: "MAPPINGS_UPDATED"; changed: boolean }
  | { type: "SYNC_REQUESTED" }
  | { type: "MAPPING_LIMIT_REJECTED" }
  | { type: "INVALID_SOURCE_SET_REJECTED" }
  | { type: "PRIMARY_NOT_FOUND_REJECTED" };

type SourceDestinationMappingSnapshot = MachineSnapshot<
  SourceDestinationMappingState,
  SourceDestinationMappingContext
>;
type SourceDestinationMappingTransitionResult = MachineTransitionResult<
  SourceDestinationMappingState,
  SourceDestinationMappingContext,
  SourceDestinationMappingCommand,
  SourceDestinationMappingOutput
>;

interface SourceDestinationMappingMachine {
  getSnapshot: () => SourceDestinationMappingSnapshot;
  dispatch: (
    envelope: EventEnvelope<SourceDestinationMappingEvent>,
  ) => SourceDestinationMappingTransitionResult;
}

class SourceDestinationMappingStateMachine
  extends StateMachine<
    SourceDestinationMappingState,
    SourceDestinationMappingContext,
    SourceDestinationMappingEvent,
    SourceDestinationMappingCommand,
    SourceDestinationMappingOutput
  >
  implements SourceDestinationMappingMachine
{
  private readonly invariants: ((snapshot: SourceDestinationMappingSnapshot) => void)[] = [
    ({ state, context }) => {
      if (state === "completed" && context.changed === globalThis.undefined) {
        throw new Error("Invariant violated: completed state requires changed flag");
      }
    },
    ({ state, context }) => {
      if (state === "rejected" && !context.rejectionReason) {
        throw new Error("Invariant violated: rejected state requires rejectionReason");
      }
    },
  ];

  constructor(input: { aggregateId: string }, options: { transitionPolicy: TransitionPolicy }) {
    super(
      "idle",
      {
        aggregateId: input.aggregateId,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(_event: SourceDestinationMappingEvent): boolean {
    return this.state === "idle";
  }

  protected getInvariants(): ((snapshot: SourceDestinationMappingSnapshot) => void)[] {
    return this.invariants;
  }

  private complete(changed: boolean): SourceDestinationMappingTransitionResult {
    this.state = "completed";
    this.context = { ...this.context, changed };
    const outputs: SourceDestinationMappingOutput[] = [{ type: "MAPPINGS_UPDATED", changed }];
    const commands: SourceDestinationMappingCommand[] = [];

    if (changed) {
      outputs.push({ type: "SYNC_REQUESTED" });
      commands.push({ type: SourceDestinationMappingCommandType.REQUEST_SYNC });
    }

    return this.result(commands, outputs);
  }

  private reject(
    reason: SourceDestinationMappingRejectionReason,
    output: SourceDestinationMappingOutput,
  ): SourceDestinationMappingTransitionResult {
    this.state = "rejected";
    this.context = { ...this.context, rejectionReason: reason };
    return this.result([], [output]);
  }

  protected transition(event: SourceDestinationMappingEvent): SourceDestinationMappingTransitionResult {
    switch (event.type) {
      case SourceDestinationMappingEventType.UPDATE_APPLIED: {
        return this.complete(event.changed);
      }
      case SourceDestinationMappingEventType.LIMIT_REJECTED: {
        return this.reject("limit", { type: "MAPPING_LIMIT_REJECTED" });
      }
      case SourceDestinationMappingEventType.INVALID_SET_REJECTED: {
        return this.reject("invalid_set", { type: "INVALID_SOURCE_SET_REJECTED" });
      }
      case SourceDestinationMappingEventType.PRIMARY_NOT_FOUND_REJECTED: {
        return this.reject("primary_not_found", { type: "PRIMARY_NOT_FOUND_REJECTED" });
      }
      default: {
        return this.result();
      }
    }
  }
}

export {
  SourceDestinationMappingCommandType,
  SourceDestinationMappingEventType,
  SourceDestinationMappingStateMachine,
};
export type {
  SourceDestinationMappingCommand,
  SourceDestinationMappingContext,
  SourceDestinationMappingEvent,
  SourceDestinationMappingMachine,
  SourceDestinationMappingOutput,
  SourceDestinationMappingSnapshot,
  SourceDestinationMappingState,
  SourceDestinationMappingTransitionResult,
};
