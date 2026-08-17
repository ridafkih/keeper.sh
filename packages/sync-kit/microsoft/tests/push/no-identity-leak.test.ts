import { describe, expect, test } from "vitest";
import { decodeGraphPush } from "../../src/push/receiver";

const notificationNamingACalendar = JSON.stringify({
  value: [
    {
      subscriptionId: "subscription-one",
      clientState: "presented-secret",
      changeType: "updated",
      resource: "Users/mailbox-one/Calendars/AAMkAGVmMDEz/Events/id-one",
      resourceData: { id: "id-one" },
    },
  ],
});

describe("a notification is a trigger, never a source of calendar identity", () => {
  test("MS-P3: no calendar identifier is derived from the resource path", () => {
    const signal = decodeGraphPush({
      url: "https://keeper.sh/webhook/outlook",
      method: "POST",
      body: notificationNamingACalendar,
    });

    if (signal.kind !== "notification") {
      throw new Error(`a notification decoded as "${signal.kind}"`);
    }
    expect(signal.claims).toEqual([
      {
        subscriptionId: "subscription-one",
        presentedClientState: "presented-secret",
        lifecycle: null,
        hint: { kind: "richHint", changeType: "updated", hasResourceData: true },
      },
    ]);
    expect(JSON.stringify(signal.claims)).not.toContain("AAMkAGVmMDEz");
  });
});
