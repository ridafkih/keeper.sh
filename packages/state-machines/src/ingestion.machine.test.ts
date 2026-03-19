import { describe, expect, it } from "bun:test";
import { IngestionFailureType, IngestionStateMachine } from "./ingestion.machine";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { ErrorPolicy } from "./errors/error-policy";
import { TransitionPolicy } from "./core/transition-policy";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-ingest-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:10:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("IngestionMachine", () => {
  it("starts in ready state", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "google",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    expect(machine.getSnapshot().state).toBe("ready");
  });

  it("transitions ready -> fetching on START", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "google",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    const result = machine.dispatch(
      envelope({ type: "START" }, { type: "system", id: "cron" }),
    );

    expect(result.state).toBe("fetching");
  });

  it("reaches completed with change output", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "google",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });

    machine.dispatch(envelope({ type: "START" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "FETCH_OK" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "DIFF_OK" }, { type: "system", id: "cron" }));

    const result = machine.dispatch(
      envelope(
        {
          type: "APPLY_OK",
          eventsAdded: 2,
          eventsRemoved: 1,
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(result.state).toBe("completed");
    expect(result.outputs).toContainEqual({
      type: "SOURCE_CHANGED",
      eventsAdded: 2,
      eventsRemoved: 1,
    });
  });

  it("transitions to auth_blocked on auth error", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "outlook",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "START" }, { type: "system", id: "cron" }));

    const result = machine.dispatch(
      envelope(
        {
          code: "provider-auth-failed",
          type: "FETCH_AUTH_ERROR",
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(result.state).toBe("auth_blocked");
    expect(result.outputs).toContainEqual({
      type: "SOURCE_FAILED",
      code: "provider-auth-failed",
      failureType: IngestionFailureType.AUTH,
      policy: ErrorPolicy.REQUIRES_REAUTH,
    });
    expect(result.context.lastError?.policy).toBe(ErrorPolicy.REQUIRES_REAUTH);
  });

  it("rejects out-of-order DIFF_OK in strict mode", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "google",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.REJECT });

    expect(() =>
      machine.dispatch(
        envelope({ type: "DIFF_OK" }, { type: "system", id: "cron" }),
      ),
    ).toThrow("Transition rejected");
  });

  it("rejects restart after terminal auth_blocked in strict mode", () => {
    const machine = new IngestionStateMachine({
      accountId: "acc-1",
      provider: "google",
      sourceCalendarId: "src-1",
      userId: "user-1",
    }, { transitionPolicy: TransitionPolicy.REJECT });
    machine.dispatch(envelope({ type: "START" }, { type: "system", id: "cron" }));
    machine.dispatch(
      envelope(
        { code: "provider-auth-failed", type: "FETCH_AUTH_ERROR" },
        { type: "system", id: "cron" },
      ),
    );

    expect(() =>
      machine.dispatch(
        envelope({ type: "START" }, { type: "system", id: "cron" }),
      ),
    ).toThrow("Transition rejected");
  });
});
