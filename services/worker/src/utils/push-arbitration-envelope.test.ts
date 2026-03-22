import { describe, expect, it } from "bun:test";
import {
  PushJobArbitrationEventType,
  type PushJobArbitrationEvent,
} from "@keeper.sh/state-machines";
import { createPushArbitrationEnvelopeFactory } from "./push-arbitration-envelope";

describe("createPushArbitrationEnvelopeFactory", () => {
  it("builds deterministic envelope ids from event type and job id", () => {
    const createEnvelope = createPushArbitrationEnvelopeFactory({
      actorId: "worker-bullmq",
      now: () => "2026-03-22T10:00:00.000Z",
    });
    const event: PushJobArbitrationEvent = {
      jobId: "job-123",
      type: PushJobArbitrationEventType.JOB_ACTIVATED,
    };

    const envelope = createEnvelope(event, "job-123");

    expect(envelope.id).toBe(`${PushJobArbitrationEventType.JOB_ACTIVATED}:job-123`);
    expect(envelope.actor).toEqual({ id: "worker-bullmq", type: "system" });
    expect(envelope.occurredAt).toBe("2026-03-22T10:00:00.000Z");
    expect(envelope.event).toEqual(event);
  });
});
