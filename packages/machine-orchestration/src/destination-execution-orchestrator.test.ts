import { describe, expect, it } from "bun:test";
import { DestinationExecutionStateMachine, TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { DestinationExecutionOrchestrator } from "./destination-execution-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-destination-${sequence}`,
        occurredAt: `2026-03-19T13:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("DestinationExecutionOrchestrator", () => {
  it("releases lock and emits change event on successful execution", () => {
    const orchestrator = new DestinationExecutionOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new DestinationExecutionStateMachine(
        { calendarId: "cal-1", failureCount: 0 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({ actorId: "worker-1", holderId: "lock-1", type: "LOCK_ACQUIRED" });
    orchestrator.handleTransition({ actorId: "worker-1", type: "EXECUTION_STARTED" });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      eventsAdded: 2,
      eventsRemoved: 1,
      type: "EXECUTION_SUCCEEDED",
    });

    expect(transition.state).toBe("completed");
    expect(transition.commands).toEqual([
      { holderId: "lock-1", type: "RELEASE_LOCK" },
      { eventsAdded: 2, eventsRemoved: 1, type: "EMIT_SYNC_EVENT" },
    ]);
  });

  it("schedules backoff and releases lock on retryable failure", () => {
    const orchestrator = new DestinationExecutionOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new DestinationExecutionStateMachine(
        { calendarId: "cal-1", failureCount: 0 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({ actorId: "worker-1", holderId: "lock-1", type: "LOCK_ACQUIRED" });
    orchestrator.handleTransition({ actorId: "worker-1", type: "EXECUTION_STARTED" });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      code: "timeout",
      nextAttemptAt: "2026-03-19T13:15:00.000Z",
      type: "EXECUTION_RETRYABLE_FAILED",
    });

    expect(transition.state).toBe("backoff_scheduled");
    expect(transition.commands).toEqual([
      { nextAttemptAt: "2026-03-19T13:15:00.000Z", type: "APPLY_BACKOFF" },
      { holderId: "lock-1", type: "RELEASE_LOCK" },
    ]);
  });

  it("rejects out-of-order success in strict mode", () => {
    const orchestrator = new DestinationExecutionOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new DestinationExecutionStateMachine(
        { calendarId: "cal-1", failureCount: 0 },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    expect(() =>
      orchestrator.handleTransition({
        actorId: "worker-1",
        eventsAdded: 1,
        eventsRemoved: 0,
        type: "EXECUTION_SUCCEEDED",
      }),
    ).toThrow("Transition rejected");
  });
});
