import { describe, expect, it } from "bun:test";
import { SyncLifecycleApplicationService } from "./sync-lifecycle.application-service";
import { createEventEnvelope } from "../core/event-envelope";
import type { EventActor } from "../core/event-envelope";
import { SyncLifecycleStateMachine } from "../sync-lifecycle.machine";
import { TransitionPolicy } from "../core/transition-policy";

let envelopeSequence = 0;
const envelope = <TEvent>(event: TEvent, actor: EventActor) => {
  envelopeSequence += 1;
  return createEventEnvelope(event, actor, {
    id: `env-app-${envelopeSequence}`,
    occurredAt: `2026-03-19T10:40:${String(envelopeSequence).padStart(2, "0")}.000Z`,
  });
};

describe("SyncLifecycleApplicationService", () => {
  it("owns idempotent enqueue orchestration for lifecycle command", () => {
    const enqueues: { userId: string; idempotencyKey: string }[] = [];
    let broadcasts = 0;

    const service = new SyncLifecycleApplicationService({
      broadcaster: {
        publishSyncAggregateUpdate: () => {
          broadcasts += 1;
        },
      },
      jobCoordinator: {
        requestEnqueueIdempotent: (userId, idempotencyKey) => {
          enqueues.push({ userId, idempotencyKey });
        },
      },
      machine: new SyncLifecycleStateMachine({ transitionPolicy: TransitionPolicy.IGNORE }),
      userId: "user-1",
    });

    service.handle(
      envelope({ type: "INGEST_CHANGED" }, { type: "system", id: "cron" }),
    );

    expect(enqueues.length).toBe(1);
    expect(broadcasts).toBe(0);
    expect(enqueues[0]?.userId).toBe("user-1");
    expect(typeof enqueues[0]?.idempotencyKey).toBe("string");
  });
});
