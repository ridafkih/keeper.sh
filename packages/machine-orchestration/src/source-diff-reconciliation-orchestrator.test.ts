import { describe, expect, it } from "bun:test";
import {
  ErrorPolicy,
  SourceDiffReconciliationCommandType,
  SourceDiffReconciliationEventType,
  SourceDiffReconciliationStateMachine,
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { SourceDiffReconciliationOrchestrator } from "./source-diff-reconciliation-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-source-diff-orch-${sequence}`,
        occurredAt: `2026-03-19T15:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("SourceDiffReconciliationOrchestrator", () => {
  it("maps request + diff events and emits apply command", () => {
    const orchestrator = new SourceDiffReconciliationOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceDiffReconciliationStateMachine(
        { sourceId: "source-10" },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({
      actorId: "cron-1",
      type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED,
    });
    const transition = orchestrator.handleTransition({
      actorId: "cron-1",
      addedCount: 2,
      removedCount: 1,
      type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
      updatedCount: 1,
    });

    expect(transition.state).toBe("diff_ready");
    expect(transition.commands).toEqual([
      {
        addedCount: 2,
        removedCount: 1,
        type: SourceDiffReconciliationCommandType.APPLY_DIFF,
        updatedCount: 1,
      },
    ]);
  });

  it("maps apply failure to retryable failed output", () => {
    const orchestrator = new SourceDiffReconciliationOrchestrator({
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SourceDiffReconciliationStateMachine(
        { sourceId: "source-11" },
        { transitionPolicy: TransitionPolicy.REJECT },
      ),
    });

    orchestrator.handleTransition({
      actorId: "cron-1",
      type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED,
    });
    orchestrator.handleTransition({
      actorId: "cron-1",
      addedCount: 0,
      removedCount: 1,
      type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
      updatedCount: 0,
    });
    orchestrator.handleTransition({
      actorId: "worker-1",
      type: SourceDiffReconciliationEventType.APPLY_STARTED,
    });
    const transition = orchestrator.handleTransition({
      actorId: "worker-1",
      code: "timeout",
      type: SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED,
    });

    expect(transition.state).toBe("failed_retryable");
    expect(transition.outputs).toEqual([
      { code: "timeout", policy: ErrorPolicy.RETRYABLE, type: "RECONCILIATION_FAILED" },
    ]);
  });
});
