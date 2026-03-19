import { describe, expect, it } from "bun:test";
import { SyncLifecycleStateMachine } from "./sync-lifecycle.machine";
import { createEventEnvelope } from "./core/event-envelope";
import type { EventActor } from "./core/event-envelope";
import { ErrorPolicy } from "./errors/error-policy";
import { TransitionPolicy } from "./core/transition-policy";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-sync-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:00:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SyncLifecycleMachine", () => {
  it("starts idle with no pending reasons", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    const snapshot = machine.getSnapshot();

    expect(snapshot.state).toBe("idle");
    expect(snapshot.context.pendingReasons.size).toBe(0);
  });

  it("moves idle -> pending on ingest change and emits enqueue command", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });

    const result = machine.dispatch(
      envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }),
    );

    expect(result.state).toBe("pending");
    expect(result.context.pendingReasons.has("ingest_changed")).toBe(true);
    expect(result.commands).toContainEqual({
      type: "REQUEST_PUSH_SYNC_ENQUEUE",
    });
  });

  it("moves pending -> running on job start", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));

    const result = machine.dispatch(
      envelope({ type: "JOB_STARTED", jobId: "job-1" }, { type: "system", id: "worker" }),
    );

    expect(result.state).toBe("running");
    expect(result.context.activeJobId).toBe("job-1");
  });

  it("moves running -> idle on successful completion with no pending reasons", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "JOB_STARTED", jobId: "job-1" }, { type: "system", id: "worker" }));
    machine.dispatch(envelope({ type: "SETTINGS_CLEAN" }, { type: "system", id: "api" }));

    const result = machine.dispatch(
      envelope({ type: "JOB_COMPLETED", jobId: "job-1" }, { type: "system", id: "worker" }),
    );

    expect(result.state).toBe("idle");
    expect(result.context.activeJobId).toBeUndefined();
  });

  it("moves running -> degraded on job failure", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "JOB_STARTED", jobId: "job-1" }, { type: "system", id: "worker" }));

    const result = machine.dispatch(
      envelope(
        {
          type: "JOB_FAILED",
          code: "provider-api-timeout",
          jobId: "job-1",
          policy: ErrorPolicy.RETRYABLE,
        },
        { type: "system", id: "worker" },
      ),
    );

    expect(result.state).toBe("degraded");
    expect(result.context.lastError?.code).toBe("provider-api-timeout");
    expect(result.context.lastError?.policy).toBe(ErrorPolicy.RETRYABLE);
  });

  it("rejects invalid completion transition in strict mode", () => {
    const machine = new SyncLifecycleStateMachine({
      transitionPolicy: TransitionPolicy.REJECT,
    });

    expect(() =>
      machine.dispatch(
        envelope(
          { type: "JOB_COMPLETED", jobId: "missing" },
          { type: "system", id: "worker" },
        ),
      ),
    ).toThrow("Transition rejected");
  });

  it("ignores stale completion for wrong job in default policy", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "JOB_STARTED", jobId: "job-1" }, { type: "system", id: "worker" }));

    const result = machine.dispatch(
      envelope(
        { type: "JOB_COMPLETED", jobId: "job-2" },
        { type: "system", id: "worker" },
      ),
    );

    expect(result.state).toBe("running");
    expect(result.commands).toEqual([]);
    expect(result.context.activeJobId).toBe("job-1");
  });

  it("recovers from degraded to pending when new work is signaled", () => {
    const machine = new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE });
    machine.dispatch(envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }));
    machine.dispatch(envelope({ type: "JOB_STARTED", jobId: "job-1" }, { type: "system", id: "worker" }));
    machine.dispatch(
      envelope(
        { type: "JOB_FAILED", code: "timeout", jobId: "job-1", policy: ErrorPolicy.RETRYABLE },
        { type: "system", id: "worker" },
      ),
    );

    const result = machine.dispatch(
      envelope({ type: "MANUAL_SYNC_REQUESTED" }, { type: "system", id: "api" }),
    );

    expect(result.state).toBe("pending");
    expect(result.context.pendingReasons.has("manual")).toBe(true);
  });
});
