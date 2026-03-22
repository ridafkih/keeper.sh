import { describe, expect, it } from "bun:test";
import { createSequencedRuntimeEnvelopeFactory } from "./sequenced-runtime-envelope-factory";

describe("createSequencedRuntimeEnvelopeFactory", () => {
  it("creates deterministic sequential envelope ids", () => {
    const createEnvelope = createSequencedRuntimeEnvelopeFactory({
      actor: { id: "runtime-test", type: "system" },
      aggregateId: "agg-1",
      now: () => "2026-03-21T10:00:00.000Z",
    });

    const first = createEnvelope({ type: "EVENT_A" });
    const second = createEnvelope({ type: "EVENT_B" });

    expect(first.id).toBe("agg-1:1:EVENT_A");
    expect(second.id).toBe("agg-1:2:EVENT_B");
    expect(first.actor).toEqual({ id: "runtime-test", type: "system" });
    expect(second.occurredAt).toBe("2026-03-21T10:00:00.000Z");
  });

  it("uses event type in envelope payload", () => {
    const createEnvelope = createSequencedRuntimeEnvelopeFactory({
      actor: { id: "runtime-test", type: "system" },
      aggregateId: "agg-2",
      now: () => "2026-03-21T11:00:00.000Z",
    });

    const envelope = createEnvelope({ type: "SOURCE_CREATED", sourceIds: ["src-1"] });
    expect(envelope.event).toEqual({ type: "SOURCE_CREATED", sourceIds: ["src-1"] });
  });
});
