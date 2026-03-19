import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { DestinationExecutionStateMachine } from "./destination-execution.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-dest-${envelopeSequence}`,
    occurredAt: `2026-03-19T13:10:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("DestinationExecutionStateMachine", () => {
  it("releases lock and emits completion output on success", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-1", failureCount: 0 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ holderId: "holder-1", type: "LOCK_ACQUIRED" }, { type: "worker", id: "w-1" }));
    machine.dispatch(envelope({ type: "EXECUTION_STARTED" }, { type: "worker", id: "w-1" }));

    const transition = machine.dispatch(
      envelope({ eventsAdded: 2, eventsRemoved: 1, type: "EXECUTION_SUCCEEDED" }, { type: "worker", id: "w-1" }),
    );

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([
      { holderId: "holder-1", type: "RELEASE_LOCK" },
      { eventsAdded: 2, eventsRemoved: 1, type: "EMIT_SYNC_EVENT" },
    ]);
    expect(transition.outputs).toEqual([{ changed: true, type: "DESTINATION_EXECUTION_COMPLETED" }]);
  });

  it("schedules backoff and releases lock on retryable failure", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-2", failureCount: 1 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ holderId: "holder-2", type: "LOCK_ACQUIRED" }, { type: "worker", id: "w-2" }));
    machine.dispatch(envelope({ type: "EXECUTION_STARTED" }, { type: "worker", id: "w-2" }));

    const transition = machine.dispatch(
      envelope(
        {
          code: "rate-limited",
          nextAttemptAt: "2026-03-19T13:30:00.000Z",
          type: "EXECUTION_RETRYABLE_FAILED",
        },
        { type: "worker", id: "w-2" },
      ),
    );

    expect(transition.state).toBe("backoff_scheduled");
    expect(transition.context.failureCount).toBe(2);
    expect(transition.commands).toEqual([
      { nextAttemptAt: "2026-03-19T13:30:00.000Z", type: "APPLY_BACKOFF" },
      { holderId: "holder-2", type: "RELEASE_LOCK" },
    ]);
    expect(transition.outputs).toEqual([{ code: "rate-limited", retryable: true, type: "DESTINATION_EXECUTION_FAILED" }]);
  });

  it("disables destination and releases lock on fatal failure", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-3", failureCount: 2 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(envelope({ holderId: "holder-3", type: "LOCK_ACQUIRED" }, { type: "worker", id: "w-3" }));
    machine.dispatch(envelope({ type: "EXECUTION_STARTED" }, { type: "worker", id: "w-3" }));

    const transition = machine.dispatch(
      envelope(
        { code: "forbidden", reason: "auth-permanent", type: "EXECUTION_FATAL_FAILED" },
        { type: "worker", id: "w-3" },
      ),
    );

    expect(transition.state).toBe("disabled_terminal");
    expect(transition.context.disableReason).toBe("auth-permanent");
    expect(transition.commands).toEqual([
      { reason: "auth-permanent", type: "DISABLE_DESTINATION" },
      { holderId: "holder-3", type: "RELEASE_LOCK" },
    ]);
    expect(transition.outputs).toEqual([{ code: "forbidden", retryable: false, type: "DESTINATION_EXECUTION_FAILED" }]);
  });

  it("rejects out-of-order execution event in strict mode", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-4", failureCount: 0 },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope({ type: "EXECUTION_STARTED" }, { type: "worker", id: "w-4" }),
      ),
    ).toThrow("Transition rejected");
  });

  it("ignores out-of-order fatal failure in ignore mode without side effects", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-5", failureCount: 0 },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(
      envelope(
        { code: "forbidden", reason: "invalid-state", type: "EXECUTION_FATAL_FAILED" },
        { type: "worker", id: "w-5" },
      ),
    );

    expect(transition.state).toBe("ready");
    expect(transition.commands).toEqual([]);
    expect(transition.outputs).toEqual([]);
  });

  it("releases lock on invalidation and rejects terminal re-entry in strict mode", () => {
    const machine = new DestinationExecutionStateMachine(
      { calendarId: "cal-6", failureCount: 0 },
      { transitionPolicy: TransitionPolicy.REJECT },
    );
    machine.dispatch(envelope({ holderId: "holder-6", type: "LOCK_ACQUIRED" }, { type: "worker", id: "w-6" }));
    machine.dispatch(envelope({ type: "EXECUTION_STARTED" }, { type: "worker", id: "w-6" }));

    const invalidated = machine.dispatch(
      envelope({ at: "2026-03-19T14:00:00.000Z", type: "INVALIDATION_DETECTED" }, { type: "worker", id: "w-6" }),
    );

    expect(invalidated.commands).toEqual([{ holderId: "holder-6", type: "RELEASE_LOCK" }]);
    expect(() =>
      machine.dispatch(
        envelope({ eventsAdded: 1, eventsRemoved: 0, type: "EXECUTION_SUCCEEDED" }, { type: "worker", id: "w-6" }),
      ),
    ).toThrow("Transition rejected");
  });
});
