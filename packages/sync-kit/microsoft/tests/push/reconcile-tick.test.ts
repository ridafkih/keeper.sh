import { describe, expect, test } from "vitest";
import { reconcileSubscriptions } from "../../src/push/reconcile";
import type { GraphSubscription } from "../../src/push/subscription";

const ourUrl = "https://keeper.sh/webhook/outlook";

const registeredAt = (id: string, createdAt: string): GraphSubscription => ({
  id,
  resource: "users/mailbox-one/calendars/AAMkAGVmMDEz/events",
  notificationUrl: ourUrl,
  expiration: { kind: "instant", value: "2026-03-18T00:00:00.000Z" },
  includesResourceData: false,
  createdAt: { kind: "instant", value: createdAt },
});

describe("reconciliation never deletes this tick's own work", () => {
  test("MS-P15: a subscription created after the tick started is never deleted", () => {
    const plan = reconcileSubscriptions({
      listed: [
        registeredAt("from-a-previous-tick", "2026-03-10T00:00:00.000Z"),
        registeredAt("registered-during-this-tick", "2026-03-11T00:00:05.000Z"),
      ],
      ourNotificationUrl: ourUrl,
      tickStartedAt: { kind: "instant", value: "2026-03-11T00:00:00.000Z" },
      keep: [],
    });

    expect(plan.deletable).toEqual(["from-a-previous-tick"]);
    expect(plan.protectedByTick).toEqual(["registered-during-this-tick"]);
  });

  test("MS-P15: a subscription the caller means to keep is not deletable either", () => {
    const plan = reconcileSubscriptions({
      listed: [registeredAt("still-wanted", "2026-03-10T00:00:00.000Z")],
      ourNotificationUrl: ourUrl,
      tickStartedAt: { kind: "instant", value: "2026-03-11T00:00:00.000Z" },
      keep: ["still-wanted"],
    });

    expect(plan.deletable).toEqual([]);
  });
});
