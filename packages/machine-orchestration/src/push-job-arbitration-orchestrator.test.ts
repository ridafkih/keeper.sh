import { describe, expect, it } from "bun:test";
import { PushJobArbitrationStateMachine, TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { PushJobArbitrationOrchestrator } from "./push-job-arbitration-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-push-${sequence}`,
        occurredAt: `2026-03-19T12:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("PushJobArbitrationOrchestrator", () => {
  it("emits hold command when first job activates", () => {
    const orchestrator = new PushJobArbitrationOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.REJECT }),
    });

    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      jobId: "job-1",
      type: "JOB_ACTIVATED",
    });

    expect(transition.state).toBe("active");
    expect(transition.commands).toEqual([{ type: "HOLD_SYNCING" }]);
  });

  it("cancels previous job when newer job activates", () => {
    const orchestrator = new PushJobArbitrationOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.REJECT }),
    });

    orchestrator.handleTransition({ actorId: "worker-1", jobId: "job-1", type: "JOB_ACTIVATED" });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      jobId: "job-2",
      type: "JOB_ACTIVATED",
    });

    expect(transition.commands).toEqual([
      { jobId: "job-1", type: "CANCEL_JOB" },
      { type: "HOLD_SYNCING" },
    ]);
  });

  it("rejects stale completion for superseded job in strict mode", () => {
    const orchestrator = new PushJobArbitrationOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new PushJobArbitrationStateMachine({ transitionPolicy: TransitionPolicy.REJECT }),
    });

    orchestrator.handleTransition({ actorId: "worker-1", jobId: "job-1", type: "JOB_ACTIVATED" });
    orchestrator.handleTransition({ actorId: "worker-1", jobId: "job-2", type: "JOB_ACTIVATED" });

    expect(() =>
      orchestrator.handleTransition({ actorId: "worker-1", jobId: "job-1", type: "JOB_COMPLETED" }),
    ).toThrow("Transition rejected");
  });
});
