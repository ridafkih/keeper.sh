import { describe, expect, it } from "bun:test";
import { TransitionPolicy } from "@keeper.sh/state-machines";
import type { EnvelopeFactory } from "./envelope-factory";
import { createKeeperRuntime } from "./create-keeper-runtime";

const buildEnvelopeFactory = (): EnvelopeFactory => {
  let sequence = 0;
  return {
    createEnvelope: (event, actor) => {
      sequence += 1;
      return {
        actor,
        event,
        id: `env-runtime-${sequence}`,
        occurredAt: `2026-03-19T12:00:${String(sequence).padStart(2, "0")}.000Z`,
      };
    },
  };
};

describe("createKeeperRuntime", () => {
  it("builds a fully wired runtime from explicit dependencies", () => {
    const enqueues: { idempotencyKey: string; userId: string }[] = [];
    const broadcasts: string[] = [];
    const runtime = createKeeperRuntime({
      broadcaster: {
        publishLifecycleUpdate: (userId) => {
          broadcasts.push(userId);
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      ingestionInput: {
        accountId: "acc-1",
        provider: "google",
        sourceCalendarId: "src-1",
        userId: "user-1",
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ idempotencyKey, userId });
        },
      },
      sourceProvisioningInput: {
        mode: "create_single",
        provider: "google",
        requestId: "req-1",
        userId: "user-1",
      },
      transitionPolicy: TransitionPolicy.IGNORE,
      userId: "user-1",
    });

    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "INGESTION_RUN_REQUESTED" });
    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "REMOTE_FETCH_SUCCEEDED" });
    runtime.handleIngestionEvent({ actorId: "svc-worker", type: "DIFF_SUCCEEDED" });
    runtime.handleIngestionEvent({
      actorId: "svc-worker",
      eventsAdded: 2,
      eventsRemoved: 0,
      type: "APPLY_COMPLETED",
    });

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-1");
    expect(broadcasts).toEqual([]);
  });

  it("routes provisioning bootstrap output into sync runtime request", () => {
    const enqueues: { idempotencyKey: string; userId: string }[] = [];
    let broadcasts = 0;
    const runtime = createKeeperRuntime({
      broadcaster: {
        publishLifecycleUpdate: () => {
          broadcasts += 1;
        },
      },
      envelopeFactory: buildEnvelopeFactory(),
      ingestionInput: {
        accountId: "acc-2",
        provider: "google",
        sourceCalendarId: "src-2",
        userId: "user-2",
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ idempotencyKey, userId });
        },
      },
      sourceProvisioningInput: {
        mode: "create_single",
        provider: "google",
        requestId: "req-2",
        userId: "user-2",
      },
      transitionPolicy: TransitionPolicy.IGNORE,
      userId: "user-2",
    });

    runtime.handleSourceProvisioningEvent({ actorId: "user-2", type: "REQUEST_VALIDATED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-billing", type: "QUOTA_GRANTED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", type: "DEDUPLICATION_PASSED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", accountId: "acc-2", type: "ACCOUNT_CREATED" });
    runtime.handleSourceProvisioningEvent({ actorId: "svc-api", sourceIds: ["src-2"], type: "SOURCE_CREATED" });
    runtime.handleSourceProvisioningEvent({
      actorId: "svc-api",
      mode: "create_single",
      sourceIds: ["src-2"],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-2");
    expect(broadcasts).toBe(0);
  });
});
