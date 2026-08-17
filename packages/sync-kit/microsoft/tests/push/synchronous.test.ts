import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";
import { createHarness } from "../support/harness";

const oneNotification = JSON.stringify({
  value: [{ subscriptionId: "subscription-one", clientState: "secret", changeType: "updated" }],
});

describe("the receiver does no work inline, because Graph's budget is three seconds", () => {
  test("MS-L23: decoding performs no await and arms no timer", () => {
    const harness = createHarness();

    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook",
      method: "POST",
      body: oneNotification,
    });

    expect(signal).not.toBeInstanceOf(Promise);
    expect(signal.kind).toBe("notification");
    expect(harness.environment.clock.pendingTimers()).toBe(0);
    expect(harness.fake.requests()).toEqual([]);
  });
});
