import { describe, expect, it } from "bun:test";
import { SyncLifecycleApplicationService } from "./sync-lifecycle.application-service";
import { createEventEnvelope } from "../core/event-envelope";

describe("SyncLifecycleApplicationService", () => {
  it("owns idempotent enqueue orchestration for lifecycle command", () => {
    const enqueues: Array<{ userId: string; idempotencyKey: string }> = [];

    const service = new SyncLifecycleApplicationService({
      broadcaster: {
        publishSyncAggregateUpdate: () => {},
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ userId, idempotencyKey });
        },
      },
      userId: "user-1",
    });

    service.handle(
      createEventEnvelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }),
    );

    expect(enqueues.length).toBe(1);
    expect(enqueues[0]?.userId).toBe("user-1");
    expect(typeof enqueues[0]?.idempotencyKey).toBe("string");
  });
});
