import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";
import type { ErrorPolicy } from "./errors/error-policy";
import { ErrorPolicy as ErrorPolicyValue } from "./errors/error-policy";

type IngestionProvider = "google" | "outlook" | "caldav" | "ical";
type IngestionState =
  | "ready"
  | "fetching"
  | "diffing"
  | "applying"
  | "completed"
  | "auth_blocked"
  | "not_found_disabled"
  | "transient_error";

interface IngestionContext {
  accountId: string;
  provider: IngestionProvider;
  sourceCalendarId: string;
  userId: string;
  eventsAdded: number;
  eventsRemoved: number;
  lastError?: { code: string; policy: ErrorPolicy };
}

interface IngestionMachineInput {
  accountId: string;
  provider: IngestionProvider;
  sourceCalendarId: string;
  userId: string;
}

type IngestionEvent =
  | { type: "START" }
  | { type: "FETCH_OK" }
  | { type: "DIFF_OK" }
  | { type: "APPLY_OK"; eventsAdded: number; eventsRemoved: number }
  | { type: "FETCH_AUTH_ERROR"; code: string }
  | { type: "FETCH_NOT_FOUND"; code: string }
  | { type: "FETCH_TRANSIENT_ERROR"; code: string }
  | { type: "TIMEOUT"; code: string };

type IngestionCommand = never;
enum IngestionFailureType {
  AUTH = "auth",
  NOT_FOUND = "not_found",
  TRANSIENT = "transient",
}

type IngestionOutput =
  | { type: "SOURCE_CHANGED"; eventsAdded: number; eventsRemoved: number }
  | { type: "SOURCE_UNCHANGED" }
  | { type: "SOURCE_FAILED"; code: string; failureType: IngestionFailureType; policy: ErrorPolicy };

type IngestionSnapshot = MachineSnapshot<IngestionState, IngestionContext>;
type IngestionTransitionResult = MachineTransitionResult<
  IngestionState,
  IngestionContext,
  IngestionCommand,
  IngestionOutput
>;

interface IngestionMachine {
  getSnapshot: () => IngestionSnapshot;
  dispatch: (envelope: EventEnvelope<IngestionEvent>) => IngestionTransitionResult;
}

class IngestionStateMachine
  extends StateMachine<
    IngestionState,
    IngestionContext,
    IngestionEvent,
    IngestionCommand,
    IngestionOutput
  >
  implements IngestionMachine
{
  private readonly invariants: ((snapshot: IngestionSnapshot) => void)[] = [
    ({ state, context }) => {
      if (
        (state === "auth_blocked"
          || state === "not_found_disabled"
          || state === "transient_error")
        && !context.lastError
      ) {
        throw new Error("Invariant violated: error states require lastError");
      }
    },
    ({ context }) => {
      if (context.eventsAdded < 0 || context.eventsRemoved < 0) {
        throw new Error("Invariant violated: event counters must be non-negative");
      }
    },
  ];

  constructor(input: IngestionMachineInput, options: { transitionPolicy: TransitionPolicy }) {
    super(
      "ready",
      {
        ...input,
        eventsAdded: 0,
        eventsRemoved: 0,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: IngestionEvent): boolean {
    if (event.type === "START") {
      return this.state === "ready";
    }
    if (event.type === "FETCH_OK") {
      return this.state === "fetching";
    }
    if (event.type === "DIFF_OK") {
      return this.state === "diffing";
    }
    if (event.type === "APPLY_OK") {
      return this.state === "applying";
    }
    return this.state === "fetching" || this.state === "diffing" || this.state === "applying";
  }

  protected getInvariants(): ((snapshot: IngestionSnapshot) => void)[] {
    return this.invariants;
  }

  private transitionTo(
    state: IngestionState,
    outputs: IngestionOutput[] = [],
  ): IngestionTransitionResult {
    this.state = state;
    return this.result([], outputs);
  }

  private transitionToError(
    state: IngestionState,
    code: string,
    policy: ErrorPolicy,
    failureType: IngestionFailureType,
  ): IngestionTransitionResult {
    this.context = {
      ...this.context,
      lastError: { code, policy },
    };
    return this.transitionTo(state, [{ type: "SOURCE_FAILED", code, failureType, policy }]);
  }

  private transitionToCompleted(
    eventsAdded: number,
    eventsRemoved: number,
  ): IngestionTransitionResult {
    this.context = {
      ...this.context,
      eventsAdded,
      eventsRemoved,
    };
    this.state = "completed";

    if (eventsAdded > 0 || eventsRemoved > 0) {
      return this.result([], [{
        type: "SOURCE_CHANGED",
        eventsAdded,
        eventsRemoved,
      }]);
    }

    return this.result([], [{ type: "SOURCE_UNCHANGED" }]);
  }

  protected transition(event: IngestionEvent): IngestionTransitionResult {
    switch (event.type) {
      case "START": {
        return this.transitionTo("fetching");
      }

      case "FETCH_OK": {
        if (this.state === "fetching") {
          return this.transitionTo("diffing");
        }
        return this.result();
      }

      case "DIFF_OK": {
        if (this.state === "diffing") {
          return this.transitionTo("applying");
        }
        return this.result();
      }

      case "APPLY_OK": {
        if (this.state === "applying") {
          return this.transitionToCompleted(event.eventsAdded, event.eventsRemoved);
        }

        return this.result();
      }

      case "FETCH_AUTH_ERROR": {
        return this.transitionToError(
          "auth_blocked",
          event.code,
          ErrorPolicyValue.REQUIRES_REAUTH,
          IngestionFailureType.AUTH,
        );
      }

      case "FETCH_NOT_FOUND": {
        return this.transitionToError(
          "not_found_disabled",
          event.code,
          ErrorPolicyValue.TERMINAL,
          IngestionFailureType.NOT_FOUND,
        );
      }

      case "FETCH_TRANSIENT_ERROR":
      case "TIMEOUT": {
        return this.transitionToError(
          "transient_error",
          event.code,
          ErrorPolicyValue.RETRYABLE,
          IngestionFailureType.TRANSIENT,
        );
      }
      default: {
        return this.result();
      }
    }
  }
}

export { IngestionFailureType, IngestionStateMachine };
export type {
  IngestionCommand,
  IngestionContext,
  IngestionEvent,
  IngestionMachine,
  IngestionMachineInput,
  IngestionOutput,
  IngestionProvider,
  IngestionSnapshot,
  IngestionState,
  IngestionTransitionResult,
};
