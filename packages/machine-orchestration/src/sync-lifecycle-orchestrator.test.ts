import { describe, expect, it } from "bun:test";
import {
  ErrorPolicy,
  SyncLifecycleStateMachine,
  TransitionPolicy,
  createEventEnvelope,
} from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { SyncLifecycleOrchestrator } from "./sync-lifecycle-orchestrator";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return createEventEnvelope(event, actor, {
        id: `env-orch-sync-${sequence}`,
        occurredAt: `2026-03-19T11:00:${String(sequence).padStart(2, "0")}.000Z`,
      });
    },
  };
};

describe("SyncLifecycleOrchestrator", () => {
  it("requests idempotent enqueue when content changes", () => {
    const enqueues: { idempotencyKey: string; userId: string }[] = [];
    const broadcasts: string[] = [];
    const orchestrator = new SyncLifecycleOrchestrator({
      broadcaster: {
        publishLifecycleUpdate: (userId) => {
          broadcasts.push(userId);
        },
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ idempotencyKey, userId });
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE }),
      userId: "user-1",
    });

    orchestrator.handle({
      actorId: "svc-sync",
      type: "CONTENT_CHANGED",
    });

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-1");
    expect(typeof enqueues[0]?.idempotencyKey).toBe("string");
    expect(broadcasts).toEqual([]);
  });

  it("broadcasts lifecycle update when tracked job completes", () => {
    const broadcasts: string[] = [];
    let enqueues = 0;
    const orchestrator = new SyncLifecycleOrchestrator({
      broadcaster: {
        publishLifecycleUpdate: (userId) => {
          broadcasts.push(userId);
        },
      },
      jobCoordinator: {
        requestEnqueueIdempotent: () => {
          enqueues += 1;
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE }),
      userId: "user-2",
    });

    orchestrator.handle({
      actorId: "svc-sync",
      jobId: "job-1",
      type: "JOB_STARTED",
    });
    orchestrator.handle({
      actorId: "svc-worker",
      jobId: "job-1",
      type: "JOB_COMPLETED",
    });

    expect(broadcasts).toEqual(["user-2"]);
    expect(enqueues).toBe(0);
  });

  it("ignores stale job completion side effects for wrong active job", () => {
    const broadcasts: string[] = [];
    let enqueues = 0;
    const orchestrator = new SyncLifecycleOrchestrator({
      broadcaster: {
        publishLifecycleUpdate: (userId) => {
          broadcasts.push(userId);
        },
      },
      jobCoordinator: {
        requestEnqueueIdempotent: () => {
          enqueues += 1;
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE }),
      userId: "user-3",
    });

    orchestrator.handle({
      actorId: "svc-sync",
      jobId: "job-1",
      type: "JOB_STARTED",
    });
    orchestrator.handle({
      actorId: "svc-worker",
      jobId: "job-2",
      type: "JOB_COMPLETED",
    });

    expect(broadcasts).toEqual([]);
    expect(enqueues).toBe(0);
  });

  it("enters degraded state on job error with canonical error policy", () => {
    let broadcasts = 0;
    let enqueues = 0;
    const orchestrator = new SyncLifecycleOrchestrator({
      broadcaster: {
        publishLifecycleUpdate: () => {
          broadcasts += 1;
        },
      },
      jobCoordinator: {
        requestEnqueueIdempotent: () => {
          enqueues += 1;
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      machine: new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE }),
      userId: "user-4",
    });

    orchestrator.handle({
      actorId: "svc-sync",
      jobId: "job-4",
      type: "JOB_STARTED",
    });
    const snapshot = orchestrator.handle({
      actorId: "svc-worker",
      code: "SOURCE_TIMEOUT",
      jobId: "job-4",
      policy: ErrorPolicy.RETRYABLE,
      type: "JOB_FAILED",
    });

    expect(snapshot.state).toBe("degraded");
    expect(snapshot.context.lastError?.policy).toBe(ErrorPolicy.RETRYABLE);
    expect(broadcasts).toBe(1);
    expect(enqueues).toBe(0);
  });
});
