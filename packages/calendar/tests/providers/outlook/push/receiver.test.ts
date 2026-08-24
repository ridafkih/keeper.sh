import { describe, expect, it } from "vitest";
import { parseOutlookPushNotification } from "../../../../src/providers/outlook/push/receiver";

const CLAIM_KEYS = [
  "channelKey",
  "deliveryId",
  "kind",
  "lifecycleEvent",
  "presentedResourceId",
  "presentedSecret",
];

const makeRequest = (
  body: unknown,
  url = "https://www.example.com/api/webhook/outlook",
) => ({
  body,
  headers: new Headers(),
  url: new URL(url),
});

const changeEntry = (
  subscriptionId: string,
  clientState: string,
  resource: string,
) => ({
  changeType: "updated",
  clientState,
  resource,
  resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: "graph-event-1" },
  subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
  subscriptionId,
  tenantId: "tenant-1",
});

describe("parseOutlookPushNotification validation handshake", () => {
  it("decodes the validation token exactly once", () => {
    const result = parseOutlookPushNotification(makeRequest(
      null,
      "https://www.example.com/api/webhook/outlook?validationToken=abc%20def",
    ));

    expect(result).toEqual({ kind: "validation", ok: true, token: "abc def" });
  });

  it("returns the handshake verbatim even for hostile-looking tokens", () => {
    const result = parseOutlookPushNotification(makeRequest(
      null,
      `https://www.example.com/api/webhook/outlook?validationToken=${encodeURIComponent("<script>alert(1)</script>")}`,
    ));

    if (!result.ok || result.kind !== "validation") {
      throw new Error("expected a validation handshake");
    }
    expect(result.token).toBe("<script>alert(1)</script>");
  });
});

describe("parseOutlookPushNotification batches", () => {
  it("parses a batch spanning two subscriptions into one claim per entry", () => {
    const result = parseOutlookPushNotification(makeRequest({
      value: [
        changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e1"),
        changeEntry("sub-2", "secret-2", "/users/u2/calendars/c2/events/e2"),
        changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e3"),
      ],
    }));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims).toHaveLength(3);
    expect(result.claims.map((claim) => claim.channelKey))
      .toEqual(["sub-1", "sub-2", "sub-1"]);
    expect(result.claims.map((claim) => claim.presentedSecret))
      .toEqual(["secret-1", "secret-2", "secret-1"]);
    for (const claim of result.claims) {
      expect(claim.kind).toBe("change");
      expect(Object.keys(claim).toSorted()).toEqual(CLAIM_KEYS);
    }
  });

  it("uses the Graph notification id as the delivery id", () => {
    const result = parseOutlookPushNotification(makeRequest({
      value: [
        { ...changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e1"), id: "n-1" },
        { ...changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e2"), id: "n-2" },
      ],
    }));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims.map((claim) => claim.deliveryId)).toEqual(["n-1", "n-2"]);
  });

  it("declines to dedup when Graph omits the notification id", () => {
    const result = parseOutlookPushNotification(makeRequest({
      value: [changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e1")],
    }));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims[0]?.deliveryId).toBeNull();
  });

  it("never collapses separate deliveries about the same event", () => {
    const deliver = (notificationId: string): string | null => {
      const result = parseOutlookPushNotification(makeRequest({
        value: [{
          ...changeEntry("sub-1", "secret-1", "/users/u1/calendars/c1/events/e1"),
          id: notificationId,
        }],
      }));
      if (!result.ok || result.kind !== "notification") {
        throw new Error("expected a parsed notification");
      }
      return result.claims[0]?.deliveryId ?? null;
    };

    expect(deliver("n-1")).not.toBe(deliver("n-2"));
  });

  it("keeps lifecycle notifications as first-class claims", () => {
    const lifecycleEvents = [
      "missed",
      "reauthorizationRequired",
      "subscriptionRemoved",
    ];

    for (const lifecycleEvent of lifecycleEvents) {
      const result = parseOutlookPushNotification(makeRequest({
        value: [{
          clientState: "secret-1",
          lifecycleEvent,
          subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
          subscriptionId: "sub-1",
          tenantId: "tenant-1",
        }],
      }));

      if (!result.ok || result.kind !== "notification") {
        throw new Error("expected a parsed notification");
      }
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]?.kind).toBe("lifecycle");
      expect(result.claims[0]?.lifecycleEvent).toBe(lifecycleEvent);
      expect(result.claims[0]?.channelKey).toBe("sub-1");
    }
  });

  it("refuses a malformed body instead of throwing", () => {
    const malformed: unknown[] = [
      {},
      { value: "x" },
      { value: [{ clientState: "secret-1" }] },
      null,
      "not-json",
      [1, 2, 3],
    ];

    for (const body of malformed) {
      expect(() => parseOutlookPushNotification(makeRequest(body))).not.toThrow();
      expect(parseOutlookPushNotification(makeRequest(body)).ok).toBe(false);
    }
  });

  it("never exposes a calendar identifier from the resource path", () => {
    const result = parseOutlookPushNotification(makeRequest({
      value: [changeEntry("sub-1", "secret-1", "/users/u1/calendars/cal-999/events/e1")],
    }));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    for (const claim of result.claims) {
      expect(Object.keys(claim).toSorted()).toEqual(CLAIM_KEYS);
    }
    expect(result.claims[0]?.channelKey).toBe("sub-1");
  });
});
