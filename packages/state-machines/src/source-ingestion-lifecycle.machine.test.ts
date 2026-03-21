import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { ErrorPolicy } from "./errors/error-policy";
import {
  SourceIngestionLifecycleCommandType,
  SourceIngestionLifecycleEventType,
  SourceIngestionLifecycleStateMachine,
} from "./source-ingestion-lifecycle.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-ingest-life-${envelopeSequence}`,
    occurredAt: `2026-03-19T13:20:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SourceIngestionLifecycleStateMachine", () => {
  it("completes ingestion and emits token persistence command", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-1" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED }, { type: "system", id: "cron" }),
    );

    const transition = machine.dispatch(
      envelope(
        {
          eventsAdded: 5,
          eventsRemoved: 1,
          nextSyncToken: "token-1",
          type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED,
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([
      { syncToken: "token-1", type: SourceIngestionLifecycleCommandType.PERSIST_SYNC_TOKEN },
    ]);
    expect(transition.outputs).toEqual([{ changed: true, type: "INGEST_COMPLETED" }]);
  });

  it("moves to auth blocked and marks reauthentication", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "outlook", sourceId: "source-2" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }, { type: "system", id: "cron" }),
    );

    const transition = machine.dispatch(
      envelope(
        { code: "token-expired", type: SourceIngestionLifecycleEventType.AUTH_FAILURE },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("auth_blocked");
    expect(transition.commands).toEqual([{ type: SourceIngestionLifecycleCommandType.MARK_NEEDS_REAUTH }]);
    expect(transition.outputs).toEqual([
      { code: "token-expired", policy: ErrorPolicy.REQUIRES_REAUTH, type: "INGEST_FAILED" },
    ]);
  });

  it("moves to disabled state on not found", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "ical", sourceId: "source-3" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }, { type: "system", id: "cron" }),
    );

    const transition = machine.dispatch(
      envelope(
        { code: "404", type: SourceIngestionLifecycleEventType.NOT_FOUND },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("not_found_disabled");
    expect(transition.commands).toEqual([{ type: SourceIngestionLifecycleCommandType.DISABLE_SOURCE }]);
  });

  it("rejects out-of-order success transition in strict mode", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-4" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope(
          { eventsAdded: 0, eventsRemoved: 0, type: SourceIngestionLifecycleEventType.INGEST_SUCCEEDED },
          { type: "system", id: "cron" },
        ),
      ),
    ).toThrow("Transition rejected");
  });

  it("emits retryable ingest failure on transient provider error", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-5" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }, { type: "system", id: "cron" }),
    );

    const transition = machine.dispatch(
      envelope(
        { code: "timeout", type: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("transient_error");
    expect(transition.outputs).toEqual([
      { code: "timeout", policy: ErrorPolicy.RETRYABLE, type: "INGEST_FAILED" },
    ]);
  });

  it("blocks terminal state re-entry in strict mode", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-6" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.SOURCE_SELECTED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope({ type: SourceIngestionLifecycleEventType.FETCHER_RESOLVED }, { type: "system", id: "cron" }),
    );
    machine.dispatch(
      envelope(
        { code: "invalid_grant", type: SourceIngestionLifecycleEventType.AUTH_FAILURE },
        { type: "system", id: "cron" },
      ),
    );

    expect(() =>
      machine.dispatch(
        envelope({ type: SourceIngestionLifecycleEventType.FETCH_SUCCEEDED }, { type: "system", id: "cron" }),
      ),
    ).toThrow("Transition rejected");
  });
});
