import type { Instant } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { renewalInstantOf, subscriptionLifetimeMs } from "../../src/push/profile";

const expiration: Instant = { kind: "instant", value: "2026-03-18T00:00:00.000Z" };

describe("a fleet does not renew in one thundering herd", () => {
  test("MS-P13: two channels of the same lifetime renew at different instants", () => {
    const lifetime = subscriptionLifetimeMs("events", false);

    const first = renewalInstantOf(expiration, lifetime, () => 0.1);
    const second = renewalInstantOf(expiration, lifetime, () => 0.9);

    expect(first.value).not.toBe(second.value);
    expect(Date.parse(first.value)).toBeLessThan(Date.parse(expiration.value));
    expect(Date.parse(second.value)).toBeLessThan(Date.parse(expiration.value));
  });

  test("MS-P13: the stagger is deterministic for one channel", () => {
    const lifetime = subscriptionLifetimeMs("events", false);

    expect(renewalInstantOf(expiration, lifetime, () => 0.42)).toEqual(
      renewalInstantOf(expiration, lifetime, () => 0.42),
    );
  });
});
