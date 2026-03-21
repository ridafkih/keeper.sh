import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";
import type { ErrorPolicy } from "./errors/error-policy";
import { ErrorPolicy as ErrorPolicyValue } from "./errors/error-policy";

const SourceDiffReconciliationEventType = {
  APPLY_FATAL_FAILED: "APPLY_FATAL_FAILED",
  APPLY_RETRYABLE_FAILED: "APPLY_RETRYABLE_FAILED",
  APPLY_STARTED: "APPLY_STARTED",
  APPLY_SUCCEEDED: "APPLY_SUCCEEDED",
  DIFF_COMPUTED: "DIFF_COMPUTED",
  RECONCILIATION_REQUESTED: "RECONCILIATION_REQUESTED",
} as const;

const SourceDiffReconciliationCommandType = {
  APPLY_DIFF: "APPLY_DIFF",
  COMPUTE_DIFF: "COMPUTE_DIFF",
} as const;

type SourceDiffReconciliationState =
  | "idle"
  | "diff_requested"
  | "diff_ready"
  | "applying"
  | "completed"
  | "failed_retryable"
  | "failed_terminal";

interface SourceDiffReconciliationContext {
  sourceId: string;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  lastErrorCode?: string;
}

type SourceDiffReconciliationEvent =
  | { type: typeof SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED }
  | {
    type: typeof SourceDiffReconciliationEventType.DIFF_COMPUTED;
    addedCount: number;
    updatedCount: number;
    removedCount: number;
  }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_STARTED }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_SUCCEEDED }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED; code: string }
  | { type: typeof SourceDiffReconciliationEventType.APPLY_FATAL_FAILED; code: string };

type SourceDiffReconciliationCommand =
  | { type: typeof SourceDiffReconciliationCommandType.COMPUTE_DIFF }
  | {
    type: typeof SourceDiffReconciliationCommandType.APPLY_DIFF;
    addedCount: number;
    updatedCount: number;
    removedCount: number;
  };

type SourceDiffReconciliationOutput =
  | { type: "RECONCILIATION_COMPLETED"; changed: boolean }
  | { type: "RECONCILIATION_FAILED"; policy: ErrorPolicy; code: string };

type SourceDiffReconciliationSnapshot = MachineSnapshot<
  SourceDiffReconciliationState,
  SourceDiffReconciliationContext
>;
type SourceDiffReconciliationTransitionResult = MachineTransitionResult<
  SourceDiffReconciliationState,
  SourceDiffReconciliationContext,
  SourceDiffReconciliationCommand,
  SourceDiffReconciliationOutput
>;

interface SourceDiffReconciliationMachine {
  getSnapshot: () => SourceDiffReconciliationSnapshot;
  dispatch: (
    envelope: EventEnvelope<SourceDiffReconciliationEvent>,
  ) => SourceDiffReconciliationTransitionResult;
}

const getTotalOperations = (context: SourceDiffReconciliationContext): number =>
  context.addedCount + context.updatedCount + context.removedCount;

class SourceDiffReconciliationStateMachine
  extends StateMachine<
    SourceDiffReconciliationState,
    SourceDiffReconciliationContext,
    SourceDiffReconciliationEvent,
    SourceDiffReconciliationCommand,
    SourceDiffReconciliationOutput
  >
  implements SourceDiffReconciliationMachine
{
  private readonly invariants: ((snapshot: SourceDiffReconciliationSnapshot) => void)[] = [
    ({ state, context }) => {
      if ((state === "diff_ready" || state === "applying") && getTotalOperations(context) === 0) {
        throw new Error("Invariant violated: diff_ready/applying requires pending operations");
      }
    },
    ({ state, context }) => {
      if ((state === "failed_retryable" || state === "failed_terminal") && !context.lastErrorCode) {
        throw new Error("Invariant violated: failed states require lastErrorCode");
      }
    },
  ];

  constructor(
    input: { sourceId: string },
    options: { transitionPolicy: TransitionPolicy },
  ) {
    super(
      "idle",
      {
        sourceId: input.sourceId,
        addedCount: 0,
        removedCount: 0,
        updatedCount: 0,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: SourceDiffReconciliationEvent): boolean {
    switch (event.type) {
      case SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED: {
        return this.state === "idle";
      }
      case SourceDiffReconciliationEventType.DIFF_COMPUTED: {
        return this.state === "diff_requested";
      }
      case SourceDiffReconciliationEventType.APPLY_STARTED: {
        return this.state === "diff_ready";
      }
      case SourceDiffReconciliationEventType.APPLY_SUCCEEDED:
      case SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED:
      case SourceDiffReconciliationEventType.APPLY_FATAL_FAILED: {
        return this.state === "applying";
      }
      default: {
        return false;
      }
    }
  }

  protected getInvariants(): ((snapshot: SourceDiffReconciliationSnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: SourceDiffReconciliationEvent): SourceDiffReconciliationTransitionResult {
    switch (event.type) {
      case SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED: {
        this.state = "diff_requested";
        return this.result([{ type: SourceDiffReconciliationCommandType.COMPUTE_DIFF }]);
      }
      case SourceDiffReconciliationEventType.DIFF_COMPUTED: {
        this.context = {
          ...this.context,
          addedCount: event.addedCount,
          removedCount: event.removedCount,
          updatedCount: event.updatedCount,
        };
        if (getTotalOperations(this.context) === 0) {
          this.state = "completed";
          return this.result([], [{ changed: false, type: "RECONCILIATION_COMPLETED" }]);
        }
        this.state = "diff_ready";
        return this.result([
          {
            type: SourceDiffReconciliationCommandType.APPLY_DIFF,
            addedCount: this.context.addedCount,
            removedCount: this.context.removedCount,
            updatedCount: this.context.updatedCount,
          },
        ]);
      }
      case SourceDiffReconciliationEventType.APPLY_STARTED: {
        this.state = "applying";
        return this.result();
      }
      case SourceDiffReconciliationEventType.APPLY_SUCCEEDED: {
        this.state = "completed";
        return this.result([], [{ changed: true, type: "RECONCILIATION_COMPLETED" }]);
      }
      case SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED: {
        this.state = "failed_retryable";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [],
          [{ code: event.code, policy: ErrorPolicyValue.RETRYABLE, type: "RECONCILIATION_FAILED" }],
        );
      }
      case SourceDiffReconciliationEventType.APPLY_FATAL_FAILED: {
        this.state = "failed_terminal";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [],
          [{ code: event.code, policy: ErrorPolicyValue.TERMINAL, type: "RECONCILIATION_FAILED" }],
        );
      }
      default: {
        return this.result();
      }
    }
  }
}

export {
  SourceDiffReconciliationCommandType,
  SourceDiffReconciliationEventType,
  SourceDiffReconciliationStateMachine,
};
export type {
  SourceDiffReconciliationCommand,
  SourceDiffReconciliationContext,
  SourceDiffReconciliationEvent,
  SourceDiffReconciliationMachine,
  SourceDiffReconciliationOutput,
  SourceDiffReconciliationSnapshot,
  SourceDiffReconciliationState,
  SourceDiffReconciliationTransitionResult,
};
