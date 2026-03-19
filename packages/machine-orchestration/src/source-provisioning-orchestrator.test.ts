import { describe, expect, it } from "bun:test";
import {
  SourceProvisioningStateMachine,
  TransitionPolicy,
  createEventEnvelope,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { SourceProvisioningOrchestrator } from "./source-provisioning-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return createEventEnvelope(event, actor, {
        id: `env-orch-provision-${sequence}`,
        occurredAt: `2026-03-19T11:20:${String(sequence).padStart(2, "0")}.000Z`,
      });
    },
  };
};

describe("SourceProvisioningOrchestrator", () => {
  it("emits bootstrap output on happy path completion", () => {
    const orchestrator = new SourceProvisioningOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceProvisioningStateMachine({
        mode: "create_single",
        provider: "google",
        requestId: "req-1",
        userId: "user-1",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
    });

    orchestrator.handle({ actorId: "user-1", type: "REQUEST_VALIDATED" });
    orchestrator.handle({ actorId: "svc-billing", type: "QUOTA_GRANTED" });
    orchestrator.handle({ actorId: "svc-api", type: "DEDUPLICATION_PASSED" });
    orchestrator.handle({ actorId: "svc-api", accountId: "acc-1", type: "ACCOUNT_REUSED" });
    orchestrator.handle({ actorId: "svc-api", sourceIds: ["src-1"], type: "SOURCE_CREATED" });
    const transition = orchestrator.handleTransition({
      actorId: "svc-api",
      mode: "create_single",
      sourceIds: ["src-1"],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });

    expect(transition.state).toBe("done");
    expect(transition.outputs).toContainEqual({
      mode: "create_single",
      sourceIds: ["src-1"],
      type: "BOOTSTRAP_REQUESTED",
    });
  });

  it("captures rejection path and does not emit bootstrap output", () => {
    const orchestrator = new SourceProvisioningOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceProvisioningStateMachine({
        mode: "create_single",
        provider: "ics",
        requestId: "req-2",
        userId: "user-2",
      }, { transitionPolicy: TransitionPolicy.IGNORE }),
    });

    orchestrator.handle({ actorId: "user-2", type: "REQUEST_VALIDATED" });
    const transition = orchestrator.handleTransition({ actorId: "svc-billing", type: "QUOTA_EXCEEDED" });

    expect(transition.state).toBe("rejected");
    expect(transition.context.rejectionReason).toBe("limit");
    expect(transition.outputs).toEqual([]);
  });
});
