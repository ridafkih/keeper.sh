import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import { PushJobArbitrationStateMachine } from "./push-job-arbitration.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-job-${envelopeSequence}`,
    occurredAt: `2026-03-19T13:00:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("PushJobArbitrationStateMachine", () => {
  it("starts idle with no active job", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });

    expect(machine.getSnapshot()).toEqual({
      context: {},
      state: "idle",
    });
  });

  it("activates first job and emits hold command", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });

    const transition = machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    expect(transition.state).toBe("active");
    expect(transition.context.activeJobId).toBe("job-1");
    expect(transition.commands).toEqual([{ type: "HOLD_SYNCING" }]);
  });

  it("supersedes active job and emits cancel + hold commands", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    const transition = machine.dispatch(
      envelope({ jobId: "job-2", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    expect(transition.state).toBe("active");
    expect(transition.context.activeJobId).toBe("job-2");
    expect(transition.commands).toEqual([
      { jobId: "job-1", type: "CANCEL_JOB" },
      { type: "HOLD_SYNCING" },
    ]);
  });

  it("ignores stale completion for superseded job in ignore mode", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );
    machine.dispatch(
      envelope({ jobId: "job-2", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    const transition = machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_COMPLETED" }, { type: "worker", id: "worker-1" }),
    );

    expect(transition.state).toBe("active");
    expect(transition.context.activeJobId).toBe("job-2");
    expect(transition.commands).toEqual([]);
  });

  it("releases syncing when active job completes", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    const transition = machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_COMPLETED" }, { type: "worker", id: "worker-1" }),
    );

    expect(transition.state).toBe("idle");
    expect(transition.context.activeJobId).toBeUndefined();
    expect(transition.commands).toEqual([{ type: "RELEASE_SYNCING" }]);
  });

  it("rejects stale terminal event in strict mode", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.REJECT });
    machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );
    machine.dispatch(
      envelope({ jobId: "job-2", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    expect(() =>
      machine.dispatch(
        envelope({ jobId: "job-1", type: "JOB_FAILED" }, { type: "worker", id: "worker-1" }),
      ),
    ).toThrow("Transition rejected");
  });

  it("does not double-release on replayed completion in ignore mode", () => {
    const machine = new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_ACTIVATED" }, { type: "worker", id: "worker-1" }),
    );

    const first = machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_COMPLETED" }, { type: "worker", id: "worker-1" }),
    );
    const replay = machine.dispatch(
      envelope({ jobId: "job-1", type: "JOB_COMPLETED" }, { type: "worker", id: "worker-1" }),
    );

    expect(first.commands).toEqual([{ type: "RELEASE_SYNCING" }]);
    expect(replay.commands).toEqual([]);
    expect(replay.state).toBe("idle");
  });
});
