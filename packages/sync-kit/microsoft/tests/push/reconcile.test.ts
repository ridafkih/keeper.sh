import { describe, expect, test } from "vitest";
import { ownsNotificationUrl, reconcileSubscriptions } from "../../src/push/reconcile";
import type { GraphSubscription } from "../../src/push/subscription";
import { suiteStart } from "../support/harness";

const ourUrl = "https://keeper.sh/webhook/outlook";

const subscriptionAt = (id: string, notificationUrl: string): GraphSubscription => ({
  id,
  resource: "users/mailbox-one/calendars/AAMkAGVmMDEz/events",
  notificationUrl,
  expiration: { kind: "instant", value: "2026-03-18T00:00:00.000Z" },
  includesResourceData: false,
  createdAt: suiteStart,
});

describe("ownership of a notification url is exact, never a prefix", () => {
  test("MS-P14: a sibling url that extends ours is not ours", () => {
    expect(ownsNotificationUrl(ourUrl, ourUrl)).toBe(true);
    expect(ownsNotificationUrl(ourUrl, `${ourUrl}-staging`)).toBe(false);
    expect(ownsNotificationUrl(ourUrl, `${ourUrl}/lifecycle`)).toBe(true);
    expect(ownsNotificationUrl(ourUrl, "https://someone-else.example/webhook/outlook")).toBe(false);
  });

  test("MS-P14: a sibling deployment's subscription is never deletable", () => {
    const plan = reconcileSubscriptions({
      listed: [
        subscriptionAt("ours", ourUrl),
        subscriptionAt("theirs", `${ourUrl}-staging`),
      ],
      ourNotificationUrl: ourUrl,
      tickStartedAt: { kind: "instant", value: "2026-03-19T00:00:00.000Z" },
      keep: [],
    });

    expect(plan.deletable).toEqual(["ours"]);
    expect(plan.foreign).toEqual(["theirs"]);
  });
});
