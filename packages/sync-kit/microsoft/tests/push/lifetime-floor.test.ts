import { describe, expect, test } from "vitest";
import { expirationInstantOf, lifetimeFloorMs } from "../../src/push/profile";
import { suiteStart } from "../support/harness";

describe("an expiry Graph would silently raise is raised before the request", () => {
  test("MS-P10: an expiry under 45 minutes is raised before the request", () => {
    const requested = expirationInstantOf(suiteStart, 10 * 60 * 1000, "events", false);

    expect(Date.parse(requested.value) - Date.parse(suiteStart.value)).toBe(lifetimeFloorMs);
  });

  test("MS-P10: an expiry over the maximum is clamped under it by the safety margin", () => {
    const requested = expirationInstantOf(suiteStart, 30 * 24 * 60 * 60 * 1000, "events", false);

    expect(Date.parse(requested.value) - Date.parse(suiteStart.value)).toBeLessThan(
      10_080 * 60 * 1000,
    );
  });
});
