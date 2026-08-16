import { describe, expect, it } from "vitest";
import { WRITE_BACK_WITNESS_RESET } from "../../../src/core/sync/write-back-policy";

describe("clearing a recorded observation re-arms the mapping", () => {
  it("drops every component of the observation as one unit", () => {
    expect(WRITE_BACK_WITNESS_RESET).toMatchObject({
      destinationAvailability: null,
      destinationContentHash: null,
      destinationDescription: null,
      destinationEndTime: null,
      destinationIsAllDay: null,
      destinationLocation: null,
      destinationStartTime: null,
      destinationSummary: null,
    });
  });

  it("returns the spent budgets so a cleared quarantine can write again", () => {
    expect(WRITE_BACK_WITNESS_RESET).toMatchObject({
      writeBackDailyCount: 0,
      writeBackDailyWindowStart: null,
      writeBackEpoch: 0,
      writeBackEpochWindowStart: null,
    });
  });
});
