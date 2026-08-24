import { describe, expect, it } from "vitest";
import {
  googleWatchHeadersSchema,
  graphNotificationCollectionSchema,
  pushChannelStateSchema,
} from "../src/index";

const changeEntry = {
  changeType: "updated",
  clientState: "secret-1",
  resource: "/users/u1/calendars/c1/events/e1",
  resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: "graph-event-1" },
  subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
  subscriptionId: "sub-1",
  tenantId: "tenant-1",
};

const lifecycleEntry = {
  clientState: "secret-1",
  lifecycleEvent: "reauthorizationRequired",
  subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
  subscriptionId: "sub-1",
  tenantId: "tenant-1",
};

describe("graphNotificationCollectionSchema", () => {
  it("accepts a batch mixing change and lifecycle notifications", () => {
    expect(graphNotificationCollectionSchema.allows({
      value: [changeEntry, lifecycleEntry],
    })).toBe(true);
  });

  it("accepts a lifecycle notification carrying no resource or resourceData", () => {
    expect(graphNotificationCollectionSchema.allows({ value: [lifecycleEntry] })).toBe(true);
  });

  it("accepts an empty batch", () => {
    expect(graphNotificationCollectionSchema.allows({ value: [] })).toBe(true);
  });

  it("keeps the per-notification id Graph uses to identify a delivery", () => {
    const withId = { ...changeEntry, id: "notification-1" };

    expect(graphNotificationCollectionSchema.allows({ value: [withId] })).toBe(true);

    const parsed = graphNotificationCollectionSchema.assert({ value: [withId] });
    expect(parsed.value[0]?.id).toBe("notification-1");
  });

  it("still accepts a notification with no id, since Graph documents it as optional", () => {
    const parsed = graphNotificationCollectionSchema.assert({ value: [changeEntry] });

    expect(parsed.value[0]?.id).toBeUndefined();
  });

  it("rejects a body with no value array", () => {
    expect(graphNotificationCollectionSchema.allows({})).toBe(false);
    expect(graphNotificationCollectionSchema.allows({ value: "x" })).toBe(false);
    expect(graphNotificationCollectionSchema.allows(null)).toBe(false);
    expect(graphNotificationCollectionSchema.allows("not-json")).toBe(false);
  });

  it("rejects an entry with no subscription id", () => {
    const { subscriptionId: _subscriptionId, ...withoutSubscription } = changeEntry;

    expect(graphNotificationCollectionSchema.allows({ value: [withoutSubscription] }))
      .toBe(false);
  });
});

describe("googleWatchHeadersSchema", () => {
  it("accepts the header set a Google push delivery carries", () => {
    expect(googleWatchHeadersSchema.allows({
      channelId: "3f1b0e5a-1111-4f2a-9c22-000000000001",
      messageNumber: "7",
      resourceId: "resource-1",
      resourceState: "exists",
      token: "b".repeat(64),
    })).toBe(true);
  });

  it("rejects a delivery with no channel token", () => {
    expect(googleWatchHeadersSchema.allows({
      channelId: "3f1b0e5a-1111-4f2a-9c22-000000000001",
      messageNumber: "7",
      resourceId: "resource-1",
      resourceState: "exists",
    })).toBe(false);
  });
});

describe("pushChannelStateSchema", () => {
  it("enumerates every channel lifecycle state", () => {
    for (const state of ["active", "degraded", "failed", "registering", "removed"]) {
      expect(pushChannelStateSchema.allows(state)).toBe(true);
    }
    expect(pushChannelStateSchema.allows("verified")).toBe(false);
  });
});
