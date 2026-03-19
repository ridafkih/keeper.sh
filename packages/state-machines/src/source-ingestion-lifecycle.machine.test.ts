import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { SourceIngestionLifecycleStateMachine } from "./source-ingestion-lifecycle.machine";

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
    machine.dispatch(envelope({ type: "SOURCE_SELECTED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCHER_RESOLVED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCH_SUCCEEDED" }, { type: "system", id: "cron" }));

    const transition = machine.dispatch(
      envelope(
        {
          eventsAdded: 5,
          eventsRemoved: 1,
          nextSyncToken: "token-1",
          type: "INGEST_SUCCEEDED",
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([{ syncToken: "token-1", type: "PERSIST_SYNC_TOKEN" }]);
    expect(transition.outputs).toEqual([{ changed: true, type: "INGEST_COMPLETED" }]);
  });

  it("moves to auth blocked and marks reauthentication", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "outlook", sourceId: "source-2" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ type: "SOURCE_SELECTED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCHER_RESOLVED" }, { type: "system", id: "cron" }));

    const transition = machine.dispatch(
      envelope({ code: "token-expired", type: "AUTH_FAILURE" }, { type: "system", id: "cron" }),
    );

    expect(transition.state).toBe("auth_blocked");
    expect(transition.commands).toEqual([{ type: "MARK_NEEDS_REAUTH" }]);
    expect(transition.outputs).toEqual([{ code: "token-expired", retryable: false, type: "INGEST_FAILED" }]);
  });

  it("moves to disabled state on not found", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "ical", sourceId: "source-3" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ type: "SOURCE_SELECTED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCHER_RESOLVED" }, { type: "system", id: "cron" }));

    const transition = machine.dispatch(
      envelope({ code: "404", type: "NOT_FOUND" }, { type: "system", id: "cron" }),
    );

    expect(transition.state).toBe("not_found_disabled");
    expect(transition.commands).toEqual([{ type: "DISABLE_SOURCE" }]);
  });

  it("rejects out-of-order success transition in strict mode", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-4" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope(
          { eventsAdded: 0, eventsRemoved: 0, type: "INGEST_SUCCEEDED" },
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
    machine.dispatch(envelope({ type: "SOURCE_SELECTED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCHER_RESOLVED" }, { type: "system", id: "cron" }));

    const transition = machine.dispatch(
      envelope({ code: "timeout", type: "TRANSIENT_FAILURE" }, { type: "system", id: "cron" }),
    );

    expect(transition.state).toBe("transient_error");
    expect(transition.outputs).toEqual([{ code: "timeout", retryable: true, type: "INGEST_FAILED" }]);
  });

  it("blocks terminal state re-entry in strict mode", () => {
    const machine = new SourceIngestionLifecycleStateMachine(
      { provider: "google", sourceId: "source-6" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );
    machine.dispatch(envelope({ type: "SOURCE_SELECTED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCHER_RESOLVED" }, { type: "system", id: "cron" }));
    machine.dispatch(
      envelope({ code: "invalid_grant", type: "AUTH_FAILURE" }, { type: "system", id: "cron" }),
    );

    expect(() =>
      machine.dispatch(
        envelope({ type: "FETCH_SUCCEEDED" }, { type: "system", id: "cron" }),
      ),
    ).toThrow("Transition rejected");
  });
});
