import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";
import type { ErrorPolicy } from "./errors/error-policy";
import { ErrorPolicy as ErrorPolicyValue } from "./errors/error-policy";

const DestinationExecutionEventType = {
  EXECUTION_FAILED: "EXECUTION_FAILED",
  EXECUTION_FATAL_FAILED: "EXECUTION_FATAL_FAILED",
  EXECUTION_RETRYABLE_FAILED: "EXECUTION_RETRYABLE_FAILED",
  EXECUTION_STARTED: "EXECUTION_STARTED",
  EXECUTION_SUCCEEDED: "EXECUTION_SUCCEEDED",
  INVALIDATION_DETECTED: "INVALIDATION_DETECTED",
  LOCK_ACQUIRED: "LOCK_ACQUIRED",
  LOCK_WAIT_STARTED: "LOCK_WAIT_STARTED",
} as const;

const DestinationExecutionCommandType = {
  APPLY_BACKOFF: "APPLY_BACKOFF",
  DISABLE_DESTINATION: "DISABLE_DESTINATION",
  EMIT_SYNC_EVENT: "EMIT_SYNC_EVENT",
  RELEASE_LOCK: "RELEASE_LOCK",
} as const;

type DestinationExecutionState =
  | "ready"
  | "lock_pending"
  | "locked"
  | "executing"
  | "invalidated"
  | "backoff_scheduled"
  | "disabled_terminal"
  | "completed";

interface DestinationExecutionContext {
  calendarId: string;
  failureCount: number;
  lockHolderId?: string;
  disableReason?: string;
  backoffUntil?: string;
  invalidatedAt?: string;
  lastErrorCode?: string;
}

type DestinationExecutionEvent =
  | { type: typeof DestinationExecutionEventType.LOCK_WAIT_STARTED; holderId: string }
  | { type: typeof DestinationExecutionEventType.LOCK_ACQUIRED; holderId: string }
  | { type: typeof DestinationExecutionEventType.EXECUTION_STARTED }
  | {
    type: typeof DestinationExecutionEventType.EXECUTION_SUCCEEDED;
    eventsAdded: number;
    eventsRemoved: number;
  }
  | { type: typeof DestinationExecutionEventType.INVALIDATION_DETECTED; at: string }
  | {
    type: typeof DestinationExecutionEventType.EXECUTION_FAILED;
    code: string;
    reason: string;
    at: string;
  }
  | {
    type: typeof DestinationExecutionEventType.EXECUTION_RETRYABLE_FAILED;
    code: string;
    nextAttemptAt: string;
  }
  | { type: typeof DestinationExecutionEventType.EXECUTION_FATAL_FAILED; code: string; reason: string };

type DestinationExecutionCommand =
  | { type: typeof DestinationExecutionCommandType.RELEASE_LOCK; holderId: string }
  | { type: typeof DestinationExecutionCommandType.APPLY_BACKOFF; nextAttemptAt: string }
  | { type: typeof DestinationExecutionCommandType.DISABLE_DESTINATION; reason: string }
  | {
    type: typeof DestinationExecutionCommandType.EMIT_SYNC_EVENT;
    eventsAdded: number;
    eventsRemoved: number;
  };

type DestinationExecutionOutput =
  | { type: "DESTINATION_EXECUTION_COMPLETED"; changed: boolean }
  | { type: "DESTINATION_EXECUTION_FAILED"; policy: ErrorPolicy; code: string };

type DestinationExecutionSnapshot = MachineSnapshot<
  DestinationExecutionState,
  DestinationExecutionContext
>;
type DestinationExecutionTransitionResult = MachineTransitionResult<
  DestinationExecutionState,
  DestinationExecutionContext,
  DestinationExecutionCommand,
  DestinationExecutionOutput
>;

interface DestinationExecutionMachine {
  getSnapshot: () => DestinationExecutionSnapshot;
  dispatch: (
    envelope: EventEnvelope<DestinationExecutionEvent>,
  ) => DestinationExecutionTransitionResult;
}

class DestinationExecutionStateMachine
  extends StateMachine<
    DestinationExecutionState,
    DestinationExecutionContext,
    DestinationExecutionEvent,
    DestinationExecutionCommand,
    DestinationExecutionOutput
  >
  implements DestinationExecutionMachine
{
  private static readonly BASE_DELAY_MS = 5 * 60 * 1000;
  private static readonly DISABLE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  private readonly invariants: ((snapshot: DestinationExecutionSnapshot) => void)[] = [
    ({ state, context }) => {
      if ((state === "locked" || state === "executing") && !context.lockHolderId) {
        throw new Error("Invariant violated: locked/executing states require lockHolderId");
      }
    },
    ({ state, context }) => {
      if (state === "disabled_terminal" && !context.disableReason) {
        throw new Error("Invariant violated: disabled_terminal requires disableReason");
      }
    },
    ({ state, context }) => {
      if (state === "backoff_scheduled" && !context.backoffUntil) {
        throw new Error("Invariant violated: backoff_scheduled requires backoffUntil");
      }
    },
  ];

  constructor(
    input: { calendarId: string; failureCount: number },
    options: { transitionPolicy: TransitionPolicy },
  ) {
    super(
      "ready",
      {
        calendarId: input.calendarId,
        failureCount: input.failureCount,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: DestinationExecutionEvent): boolean {
    switch (event.type) {
      case DestinationExecutionEventType.LOCK_WAIT_STARTED: {
        return this.state === "ready";
      }
      case DestinationExecutionEventType.LOCK_ACQUIRED: {
        return this.state === "ready" || this.state === "lock_pending";
      }
      case DestinationExecutionEventType.EXECUTION_STARTED: {
        return this.state === "locked";
      }
      case DestinationExecutionEventType.EXECUTION_SUCCEEDED:
      case DestinationExecutionEventType.INVALIDATION_DETECTED:
      case DestinationExecutionEventType.EXECUTION_FAILED:
      case DestinationExecutionEventType.EXECUTION_RETRYABLE_FAILED:
      case DestinationExecutionEventType.EXECUTION_FATAL_FAILED: {
        return this.state === "executing";
      }
      default: {
        return false;
      }
    }
  }

  protected getInvariants(): ((snapshot: DestinationExecutionSnapshot) => void)[] {
    return this.invariants;
  }

  private requireLockHolderId(): string {
    const holderId = this.context.lockHolderId;
    if (!holderId) {
      throw new Error("Invariant violated: missing lock holder for release");
    }
    return holderId;
  }

  private static toNextAttemptAt(failureCount: number, at: string): string {
    const parsedAt = Date.parse(at);
    if (Number.isNaN(parsedAt)) {
      throw new TypeError("Invariant violated: failed event requires a valid at timestamp");
    }
    const uncappedDelayMs = DestinationExecutionStateMachine.BASE_DELAY_MS * (2 ** (failureCount - 1));
    const delayMs = Math.min(uncappedDelayMs, DestinationExecutionStateMachine.DISABLE_THRESHOLD_MS);
    return new Date(parsedAt + delayMs).toISOString();
  }

  private static shouldDisable(failureCount: number): boolean {
    const uncappedDelayMs = DestinationExecutionStateMachine.BASE_DELAY_MS * (2 ** (failureCount - 1));
    return uncappedDelayMs >= DestinationExecutionStateMachine.DISABLE_THRESHOLD_MS;
  }

  protected transition(event: DestinationExecutionEvent): DestinationExecutionTransitionResult {
    switch (event.type) {
      case DestinationExecutionEventType.LOCK_WAIT_STARTED: {
        this.state = "lock_pending";
        this.context = { ...this.context, lockHolderId: event.holderId };
        return this.result();
      }
      case DestinationExecutionEventType.LOCK_ACQUIRED: {
        this.state = "locked";
        this.context = { ...this.context, lockHolderId: event.holderId };
        return this.result();
      }
      case DestinationExecutionEventType.EXECUTION_STARTED: {
        this.state = "executing";
        return this.result();
      }
      case DestinationExecutionEventType.EXECUTION_SUCCEEDED: {
        const holderId = this.requireLockHolderId();
        this.state = "completed";
        const changed = event.eventsAdded > 0 || event.eventsRemoved > 0;
        const nextContext = { ...this.context };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result(
          [
            { type: DestinationExecutionCommandType.RELEASE_LOCK, holderId },
            {
              type: DestinationExecutionCommandType.EMIT_SYNC_EVENT,
              eventsAdded: event.eventsAdded,
              eventsRemoved: event.eventsRemoved,
            },
          ],
          [{ type: "DESTINATION_EXECUTION_COMPLETED", changed }],
        );
      }
      case DestinationExecutionEventType.INVALIDATION_DETECTED: {
        const holderId = this.requireLockHolderId();
        this.state = "invalidated";
        const nextContext = { ...this.context, invalidatedAt: event.at };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result([{ type: DestinationExecutionCommandType.RELEASE_LOCK, holderId }]);
      }
      case DestinationExecutionEventType.EXECUTION_FAILED: {
        const holderId = this.requireLockHolderId();
        const nextFailureCount = this.context.failureCount + 1;
        if (DestinationExecutionStateMachine.shouldDisable(nextFailureCount)) {
          this.state = "disabled_terminal";
          const nextContext = {
            ...this.context,
            disableReason: event.reason,
            failureCount: nextFailureCount,
            lastErrorCode: event.code,
          };
          delete nextContext.lockHolderId;
          this.context = nextContext;
          return this.result(
            [
              { type: DestinationExecutionCommandType.DISABLE_DESTINATION, reason: event.reason },
              { type: DestinationExecutionCommandType.RELEASE_LOCK, holderId },
            ],
            [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, policy: ErrorPolicyValue.TERMINAL }],
          );
        }

        this.state = "backoff_scheduled";
        const nextAttemptAt = DestinationExecutionStateMachine.toNextAttemptAt(nextFailureCount, event.at);
        const nextContext = {
          ...this.context,
          backoffUntil: nextAttemptAt,
          failureCount: nextFailureCount,
          lastErrorCode: event.code,
        };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result(
          [
            { type: DestinationExecutionCommandType.APPLY_BACKOFF, nextAttemptAt },
            { type: DestinationExecutionCommandType.RELEASE_LOCK, holderId },
          ],
          [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, policy: ErrorPolicyValue.RETRYABLE }],
        );
      }
      case DestinationExecutionEventType.EXECUTION_RETRYABLE_FAILED: {
        const holderId = this.requireLockHolderId();
        this.state = "backoff_scheduled";
        const nextContext = {
          ...this.context,
          backoffUntil: event.nextAttemptAt,
          failureCount: this.context.failureCount + 1,
          lastErrorCode: event.code,
        };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result(
          [
            { type: DestinationExecutionCommandType.APPLY_BACKOFF, nextAttemptAt: event.nextAttemptAt },
            { type: DestinationExecutionCommandType.RELEASE_LOCK, holderId },
          ],
          [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, policy: ErrorPolicyValue.RETRYABLE }],
        );
      }
      case DestinationExecutionEventType.EXECUTION_FATAL_FAILED: {
        const holderId = this.requireLockHolderId();
        this.state = "disabled_terminal";
        const nextContext = {
          ...this.context,
          disableReason: event.reason,
          failureCount: this.context.failureCount + 1,
          lastErrorCode: event.code,
        };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result(
          [
            { type: DestinationExecutionCommandType.DISABLE_DESTINATION, reason: event.reason },
            { type: DestinationExecutionCommandType.RELEASE_LOCK, holderId },
          ],
          [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, policy: ErrorPolicyValue.TERMINAL }],
        );
      }
      default: {
        return this.result();
      }
    }
  }
}

export {
  DestinationExecutionCommandType,
  DestinationExecutionEventType,
  DestinationExecutionStateMachine,
};
export type {
  DestinationExecutionCommand,
  DestinationExecutionContext,
  DestinationExecutionEvent,
  DestinationExecutionMachine,
  DestinationExecutionOutput,
  DestinationExecutionSnapshot,
  DestinationExecutionState,
  DestinationExecutionTransitionResult,
};
