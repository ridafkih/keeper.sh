import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

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
  | { type: "LOCK_WAIT_STARTED"; holderId: string }
  | { type: "LOCK_ACQUIRED"; holderId: string }
  | { type: "EXECUTION_STARTED" }
  | { type: "EXECUTION_SUCCEEDED"; eventsAdded: number; eventsRemoved: number }
  | { type: "INVALIDATION_DETECTED"; at: string }
  | { type: "EXECUTION_RETRYABLE_FAILED"; code: string; nextAttemptAt: string }
  | { type: "EXECUTION_FATAL_FAILED"; code: string; reason: string };

type DestinationExecutionCommand =
  | { type: "RELEASE_LOCK"; holderId: string }
  | { type: "APPLY_BACKOFF"; nextAttemptAt: string }
  | { type: "DISABLE_DESTINATION"; reason: string }
  | { type: "EMIT_SYNC_EVENT"; eventsAdded: number; eventsRemoved: number };

type DestinationExecutionOutput =
  | { type: "DESTINATION_EXECUTION_COMPLETED"; changed: boolean }
  | { type: "DESTINATION_EXECUTION_FAILED"; retryable: boolean; code: string };

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
    if (event.type === "LOCK_WAIT_STARTED") {
      return this.state === "ready";
    }
    if (event.type === "LOCK_ACQUIRED") {
      return this.state === "ready" || this.state === "lock_pending";
    }
    if (event.type === "EXECUTION_STARTED") {
      return this.state === "locked";
    }
    if (event.type === "EXECUTION_SUCCEEDED" || event.type === "INVALIDATION_DETECTED") {
      return this.state === "executing";
    }
    if (event.type === "EXECUTION_RETRYABLE_FAILED" || event.type === "EXECUTION_FATAL_FAILED") {
      return this.state === "executing";
    }
    return false;
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

  protected transition(event: DestinationExecutionEvent): DestinationExecutionTransitionResult {
    switch (event.type) {
      case "LOCK_WAIT_STARTED": {
        this.state = "lock_pending";
        this.context = { ...this.context, lockHolderId: event.holderId };
        return this.result();
      }
      case "LOCK_ACQUIRED": {
        this.state = "locked";
        this.context = { ...this.context, lockHolderId: event.holderId };
        return this.result();
      }
      case "EXECUTION_STARTED": {
        this.state = "executing";
        return this.result();
      }
      case "EXECUTION_SUCCEEDED": {
        const holderId = this.requireLockHolderId();
        this.state = "completed";
        const changed = event.eventsAdded > 0 || event.eventsRemoved > 0;
        const nextContext = { ...this.context };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result(
          [
            { type: "RELEASE_LOCK", holderId },
            { type: "EMIT_SYNC_EVENT", eventsAdded: event.eventsAdded, eventsRemoved: event.eventsRemoved },
          ],
          [{ type: "DESTINATION_EXECUTION_COMPLETED", changed }],
        );
      }
      case "INVALIDATION_DETECTED": {
        const holderId = this.requireLockHolderId();
        this.state = "invalidated";
        const nextContext = { ...this.context, invalidatedAt: event.at };
        delete nextContext.lockHolderId;
        this.context = nextContext;
        return this.result([{ type: "RELEASE_LOCK", holderId }]);
      }
      case "EXECUTION_RETRYABLE_FAILED": {
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
            { type: "APPLY_BACKOFF", nextAttemptAt: event.nextAttemptAt },
            { type: "RELEASE_LOCK", holderId },
          ],
          [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, retryable: true }],
        );
      }
      case "EXECUTION_FATAL_FAILED": {
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
            { type: "DISABLE_DESTINATION", reason: event.reason },
            { type: "RELEASE_LOCK", holderId },
          ],
          [{ type: "DESTINATION_EXECUTION_FAILED", code: event.code, retryable: false }],
        );
      }
      default: {
        return this.result();
      }
    }
  }
}

export { DestinationExecutionStateMachine };
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
