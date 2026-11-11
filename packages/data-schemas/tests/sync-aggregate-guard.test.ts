import { describe, expect, it } from "vitest";
import { isSyncAggregate } from "../src/client";

const aggregate = {
  progressPercent: 25,
  seq: 4,
  syncEventsProcessed: 300,
  syncEventsRemaining: 900,
  syncEventsTotal: 1200,
  syncing: true,
};

describe("isSyncAggregate", () => {
  it("accepts an aggregate with or without a remaining-time estimate", () => {
    expect(isSyncAggregate(aggregate)).toBe(true);
    expect(isSyncAggregate({ ...aggregate, syncSecondsRemaining: 180 })).toBe(true);
  });

  it("rejects an estimate that is not a number", () => {
    expect(isSyncAggregate({ ...aggregate, syncSecondsRemaining: "3 minutes" })).toBe(false);
  });
});
