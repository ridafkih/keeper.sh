import { StateMachine } from "./core/state-machine";
import type { MachineSnapshot, MachineTransitionResult } from "./core/state-machine";
import type { EventEnvelope } from "./core/event-envelope";
import type { TransitionPolicy } from "./core/transition-policy";

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
  | { type: "SOURCE_SELECTED" }
  | { type: "FETCHER_RESOLVED" }
  | { type: "FETCH_SUCCEEDED" }
  | { type: "INGEST_SUCCEEDED"; eventsAdded: number; eventsRemoved: number; nextSyncToken?: string }
  | { type: "AUTH_FAILURE"; code: string }
  | { type: "NOT_FOUND"; code: string }
  | { type: "TRANSIENT_FAILURE"; code: string };

type SourceIngestionLifecycleCommand =
  | { type: "MARK_NEEDS_REAUTH" }
  | { type: "DISABLE_SOURCE" }
  | { type: "PERSIST_SYNC_TOKEN"; syncToken: string };

type SourceIngestionLifecycleOutput =
  | { type: "INGEST_COMPLETED"; changed: boolean }
  | { type: "INGEST_FAILED"; retryable: boolean; code: string };

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
    if (event.type === "SOURCE_SELECTED") {
      return this.state === "source_selected";
    }
    if (event.type === "FETCHER_RESOLVED") {
      return this.state === "provider_ready";
    }
    if (event.type === "FETCH_SUCCEEDED") {
      return this.state === "fetching";
    }
    if (event.type === "INGEST_SUCCEEDED") {
      return this.state === "ingesting";
    }
    if (event.type === "AUTH_FAILURE" || event.type === "NOT_FOUND" || event.type === "TRANSIENT_FAILURE") {
      return this.state === "fetching" || this.state === "ingesting";
    }
    return false;
  }

  protected getInvariants(): ((snapshot: SourceIngestionLifecycleSnapshot) => void)[] {
    return this.invariants;
  }

  protected transition(event: SourceIngestionLifecycleEvent): SourceIngestionLifecycleTransitionResult {
    switch (event.type) {
      case "SOURCE_SELECTED": {
        this.state = "provider_ready";
        return this.result();
      }
      case "FETCHER_RESOLVED": {
        this.state = "fetching";
        return this.result();
      }
      case "FETCH_SUCCEEDED": {
        this.state = "ingesting";
        return this.result();
      }
      case "INGEST_SUCCEEDED": {
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
          commands.push({ type: "PERSIST_SYNC_TOKEN", syncToken: event.nextSyncToken });
        }
        return this.result(commands, [{ type: "INGEST_COMPLETED", changed }]);
      }
      case "AUTH_FAILURE": {
        this.state = "auth_blocked";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: "MARK_NEEDS_REAUTH" }],
          [{ type: "INGEST_FAILED", code: event.code, retryable: false }],
        );
      }
      case "NOT_FOUND": {
        this.state = "not_found_disabled";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result(
          [{ type: "DISABLE_SOURCE" }],
          [{ type: "INGEST_FAILED", code: event.code, retryable: false }],
        );
      }
      case "TRANSIENT_FAILURE": {
        this.state = "transient_error";
        this.context = { ...this.context, lastErrorCode: event.code };
        return this.result([], [{ type: "INGEST_FAILED", code: event.code, retryable: true }]);
      }
      default: {
        return this.result();
      }
    }
  }
}

export { SourceIngestionLifecycleStateMachine };
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
