import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { TransitionPolicy } from "./core/transition-policy";
import {
  SourceDiffReconciliationCommandType,
  SourceDiffReconciliationEventType,
  SourceDiffReconciliationStateMachine,
} from "./source-diff-reconciliation.machine";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-source-diff-${envelopeSequence}`,
    occurredAt: `2026-03-19T14:30:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SourceDiffReconciliationStateMachine", () => {
  it("requests diff computation on reconciliation request", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-1" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );

    const transition = machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("diff_requested");
    expect(transition.commands).toEqual([{ type: SourceDiffReconciliationCommandType.COMPUTE_DIFF }]);
  });

  it("completes immediately when diff has no operations", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-2" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
        { type: "system", id: "cron" },
      ),
    );

    const transition = machine.dispatch(
      envelope(
        {
          addedCount: 0,
          removedCount: 0,
          type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
          updatedCount: 0,
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("completed");
    expect(transition.outputs).toEqual([{ changed: false, type: "RECONCILIATION_COMPLETED" }]);
  });

  it("emits apply command when diff includes operations", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-3" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
        { type: "system", id: "cron" },
      ),
    );

    const transition = machine.dispatch(
      envelope(
        {
          addedCount: 2,
          removedCount: 1,
          type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
          updatedCount: 3,
        },
        { type: "system", id: "cron" },
      ),
    );

    expect(transition.state).toBe("diff_ready");
    expect(transition.commands).toEqual([
      {
        addedCount: 2,
        removedCount: 1,
        type: SourceDiffReconciliationCommandType.APPLY_DIFF,
        updatedCount: 3,
      },
    ]);
  });

  it("emits completion output after apply success", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-4" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
        { type: "system", id: "cron" },
      ),
    );
    machine.dispatch(
      envelope(
        {
          addedCount: 1,
          removedCount: 0,
          type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
          updatedCount: 0,
        },
        { type: "system", id: "cron" },
      ),
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.APPLY_STARTED },
        { type: "system", id: "worker" },
      ),
    );

    const transition = machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.APPLY_SUCCEEDED },
        { type: "system", id: "worker" },
      ),
    );

    expect(transition.state).toBe("completed");
    expect(transition.outputs).toEqual([{ changed: true, type: "RECONCILIATION_COMPLETED" }]);
  });

  it("emits retryable failure output", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-5" },
      { transitionPolicy: TransitionPolicy.IGNORE },
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.RECONCILIATION_REQUESTED },
        { type: "system", id: "cron" },
      ),
    );
    machine.dispatch(
      envelope(
        {
          addedCount: 0,
          removedCount: 1,
          type: SourceDiffReconciliationEventType.DIFF_COMPUTED,
          updatedCount: 0,
        },
        { type: "system", id: "cron" },
      ),
    );
    machine.dispatch(
      envelope(
        { type: SourceDiffReconciliationEventType.APPLY_STARTED },
        { type: "system", id: "worker" },
      ),
    );

    const transition = machine.dispatch(
      envelope(
        { code: "timeout", type: SourceDiffReconciliationEventType.APPLY_RETRYABLE_FAILED },
        { type: "system", id: "worker" },
      ),
    );

    expect(transition.state).toBe("failed_retryable");
    expect(transition.outputs).toEqual([{ code: "timeout", retryable: true, type: "RECONCILIATION_FAILED" }]);
  });

  it("rejects out-of-order apply success in strict mode", () => {
    const machine = new SourceDiffReconciliationStateMachine(
      { sourceId: "source-6" },
      { transitionPolicy: TransitionPolicy.REJECT },
    );

    expect(() =>
      machine.dispatch(
        envelope(
          { type: SourceDiffReconciliationEventType.APPLY_SUCCEEDED },
          { type: "system", id: "worker" },
        ),
      ),
    ).toThrow("Transition rejected");
  });
});
