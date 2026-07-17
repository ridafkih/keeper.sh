import { describe, expect, it } from "vitest";
import {
  instantToWallTime,
  wallTimeToInstant,
} from "../../../src/ics/utils/timezone-instant";

describe("timezone instant conversion", () => {
  it("shifts a nonexistent DST-gap wall time forward by the transition", () => {
    const instant = wallTimeToInstant(
      new Date("2026-03-08T02:30:00.000Z"),
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(instantToWallTime(instant, "America/New_York").toISOString())
      .toBe("2026-03-08T03:30:00.000Z");
  });

  it("chooses the earlier instant for an ambiguous DST-fold wall time", () => {
    const instant = wallTimeToInstant(
      new Date("2026-11-01T01:30:00.000Z"),
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(instantToWallTime(instant, "America/New_York").toISOString())
      .toBe("2026-11-01T01:30:00.000Z");
  });
});
