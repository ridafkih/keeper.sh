import { describe, expect, test } from "vitest";
import { subscriptionLifetimeMs } from "../../src/push/profile";

const minuteMs = 60 * 1000;

describe("lifetime is a property of the resource and the resource-data flag together", () => {
  test("MS-P9: enabling resource data selects the 1440 minute lifetime", () => {
    expect(subscriptionLifetimeMs("events", true)).toBe(1440 * minuteMs);
    expect(subscriptionLifetimeMs("events", false)).toBe(10_080 * minuteMs);
  });
});
