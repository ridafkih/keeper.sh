import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";
import type { ErrorPolicy } from "./errors/error-policy";
import { ErrorPolicy as ErrorPolicyValue } from "./errors/error-policy";

enum SourceIngestionLifecycleEventType {
  AUTH_FAILURE = "AUTH_FAILURE",
  FETCH_SUCCEEDED = "FETCH_SUCCEEDED",
  FETCHER_RESOLVED = "FETCHER_RESOLVED",
  INGEST_SUCCEEDED = "INGEST_SUCCEEDED",
  NOT_FOUND = "NOT_FOUND",
  SOURCE_SELECTED = "SOURCE_SELECTED",
  TRANSIENT_FAILURE = "TRANSIENT_FAILURE",
}

enum SourceIngestionLifecycleCommandType {
  DISABLE_SOURCE = "DISABLE_SOURCE",
  MARK_NEEDS_REAUTH = "MARK_NEEDS_REAUTH",
  PERSIST_SYNC_TOKEN = "PERSIST_SYNC_TOKEN",
}

enum SourceIngestionFailureType {
  AUTH = "auth",
  NOT_FOUND = "not_found",
  TRANSIENT = "transient",
}

type SourceIngestionLifecycleState =
  | "source_selected"
  | "provider_ready"
  | "fetching"
  | "ingesting"
  | "completed"
  | "auth_blocked"
  | "not_found_disabled"
  | "transient_error";

interface SourceIngestionLifecycleContext {
  sourceId: string;
  provider: string;
  eventsAdded: number;
  eventsRemoved: number;
  lastErrorCode?: string;
  persistedSyncToken?: string;
}

type SourceIngestionLifecycleEvent =
  | { type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }
  | { type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }
  | { type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED }
  | {
    type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED;
    eventsAdded: number;
    eventsRemoved: number;
    nextSyncToken?: string;
  }
  | { type: SourceIngestionLifecycleEventType.AUTH_FAILURE; code: string }
  | { type: SourceIngestionLifecycleEventType.NOT_FOUND; code: string }
  | { type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE; code: string };

type SourceIngestionLifecycleCommand =
  | { type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH }
  | { type: SourceIngestionLifecycleCommandType.DISABLE_SOURCE }
  | { type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN; syncToken: string };

type SourceIngestionLifecycleOutput =
  | { type: "INGEST_COMPLETED"; changed: boolean }
  | { type: "INGEST_FAILED"; policy: ErrorPolicy; code: string; failureType: SourceIngestionFailureType };

type SourceIngestionLifecycleSnapshot = MachineSnapshot<
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleContext
>;
type SourceIngestionLifecycleTransitionResult = MachineTransitionResult<
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleContext,
  SourceIngestionLifecycleCommand,
  SourceIngestionLifecycleOutput
>;

interface SourceIngestionLifecycleMachine {
  getSnapshot: () => SourceIngestionLifecycleSnapshot;
  dispatch: (
    envelope: EventEnvelope<SourceIngestionLifecycleEvent>,
  ) => SourceIngestionLifecycleTransitionResult;
}

class SourceIngestionLifecycleStateMachine
  extends StateMachine<
    SourceIngestionLifecycleState,
    SourceIngestionLifecycleContext,
    SourceIngestionLifecycleEvent,
    SourceIngestionLifecycleCommand,
    SourceIngestionLifecycleOutput
  >
  implements SourceIngestionLifecycleMachine
{
  private readonly invariants: ((snapshot: SourceIngestionLifecycleSnapshot) => void)[] = [
    ({ state, context }) => {
      if (
        (state === "auth_blocked" || state === "not_found_disabled" || state === "transient_error")
        && !context.lastErrorCode
      ) {
        throw new Error("Invariant violated: error states require lastErrorCode");
      }
    },
  ];

  constructor(
    input: { sourceId: string; provider: string },
    options: { transitionPolicy: TransitionPolicy },
  ) {
    super(
      "source_selected",
      {
        sourceId: input.sourceId,
        provider: input.provider,
        eventsAdded: 0,
        eventsRemoved: 0,
      },
      { transitionPolicy: options.transitionPolicy },
    );
  }

  protected isTransitionAllowed(event: SourceIngestionLifecycleEvent): boolean {
    switch (event.type) {
      case SourceIngestionLifecycleEventType.SOURCE_SELECTED: {
        return this.state === "source_selected";
      }
      case SourceIngestionLifecycleEventType.FETCHER_RESOLVED: {
        return this.state === "provider_ready";
      }
      case SourceIngestionLifecycleEventType.FETCH_SUCCEEDED: {
        return this.state === "fetching";
      }
      case SourceIngestionLifecycleEventType.INGEST_SUCCEEDED: {
        return this.state === "ingesting";
      }
      case SourceIngestionLifecycleEventType.AUTH_FAILURE:
      case SourceIngestionLifecycleEventType.NOT_FOUND:
      case SourceIngestionLifecycleEventType.TRANSIENT_FAILURE: {
        return this.state === "fetching" || this.state === "ingesting";
      }
      default: {
        return false;
      }
    }
  }

  protected getInvariants(): ((snapshot: SourceIngestionLifecycleSnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: SourceIngestionLifecycleEvent): SourceIngestionLifecycleTransitionResult {
    switch (event.type) {
      case SourceIngestionLifecycleEventType.SOURCE_SELECTED: {
        this.state = "provider_ready";
        return this.result();
      }
      case SourceIngestionLifecycleEventType.FETCHER_RESOLVED: {
        this.state = "fetching";
        return this.result();
      }
      case SourceIngestionLifecycleEventType.FETCH_SUCCEEDED: {
        this.state = "ingesting";
        return this.result();
      }
      case SourceIngestionLifecycleEventType.INGEST_SUCCEEDED: {
        this.state = "completed";
        this.context = {
          ...this.context,
          eventsAdded: event.eventsAdded,
          eventsRemoved: event.eventsRemoved,
          ...(event.nextSyncToken && { persistedSyncToken: event.nextSyncToken }),
        };

        const changed = event.eventsAdded > 0 || event.eventsRemoved > 0;
        const commands: SourceIngestionLifecycleCommand[] = [];
        if (event.nextSyncToken) {
          commands.push({
            type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN,
            syncToken: event.nextSyncToken,
          });
        }
        return this.result(commands, [{ type: "INGEST_COMPLETED", changed }]);
      }
      case SourceIngestionLifecycleEventType.AUTH_FAILURE: {
        this.state = "auth_blocked";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH }],
          [{
            type: "INGEST_FAILED",
            code: event.code,
            policy: ErrorPolicyValue.REQUIRES_REAUTH,
            failureType: SourceIngestionFailureType.AUTH,
          }],
        );
      }
      case SourceIngestionLifecycleEventType.NOT_FOUND: {
        this.state = "not_found_disabled";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: SourceIngestionLifecycleCommandType.DISABLE_SOURCE }],
          [{
            type: "INGEST_FAILED",
            code: event.code,
            policy: ErrorPolicyValue.TERMINAL,
            failureType: SourceIngestionFailureType.NOT_FOUND,
          }],
        );
      }
      case SourceIngestionLifecycleEventType.TRANSIENT_FAILURE: {
        this.state = "transient_error";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result([], [{
          type: "INGEST_FAILED",
          code: event.code,
          policy: ErrorPolicyValue.RETRYABLE,
          failureType: SourceIngestionFailureType.TRANSIENT,
        }]);
      }
      default: {
        return this.result();
      }
    }
  }
}

export {
  SourceIngestionLifecycleStateMachine,
  SourceIngestionLifecycleCommandType,
  SourceIngestionFailureType,
  SourceIngestionLifecycleEventType,
};
export type {
  SourceIngestionLifecycleCommand,
  SourceIngestionLifecycleContext,
  SourceIngestionLifecycleEvent,
  SourceIngestionLifecycleMachine,
  SourceIngestionLifecycleOutput,
  SourceIngestionLifecycleSnapshot,
  SourceIngestionLifecycleState,
  SourceIngestionLifecycleTransitionResult,
};
