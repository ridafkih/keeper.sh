import { describe, expect, it } from "bun:test";
import { createEventEnvelope } from "./event-envelope";

describe("event envelope", () => {
  it("creates strict envelope metadata", () => {
    const envelope = createEventEnvelope(
      { type: "INGEST_CHANGED" },
      { type: "user", id: "user-1" },
      { causationId: "cause-1", correlationId: "corr-1" },
    );

    expect(typeof envelope.id).toBe("string");
    expect(typeof envelope.occurredAt).toBe("string");
    expect(envelope.actor).toEqual({ type: "user", id: "user-1" });
    expect(envelope.causationId).toBe("cause-1");
    expect(envelope.correlationId).toBe("corr-1");
    expect(envelope.event.type).toBe("INGEST_CHANGED");
  });
});
