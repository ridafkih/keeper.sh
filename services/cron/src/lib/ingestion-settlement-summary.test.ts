import { describe, expect, it } from "bun:test";
import { summarizeIngestionSettlements } from "./ingestion-settlement-summary";

describe("summarizeIngestionSettlements", () => {
  it("aggregates fulfilled settlements and counts failures", () => {
    const summary = summarizeIngestionSettlements([
      {
        status: "fulfilled",
        value: {
          eventsAdded: 2,
          eventsRemoved: 1,
          ingestEvents: [{ id: "a" }],
        },
      },
      {
        status: "rejected",
        reason: new Error("boom"),
      },
      {
        status: "fulfilled",
        value: {
          eventsAdded: 1,
          eventsRemoved: 3,
          ingestEvents: [{ id: "b" }, { id: "c" }],
        },
      },
    ]);

    expect(summary).toEqual({
      added: 3,
      removed: 4,
      errors: 1,
      ingestEvents: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
  });
});
