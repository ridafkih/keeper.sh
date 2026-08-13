import { describe, expect, it } from "vitest";
import { parseGooglePushNotification } from "../../../../src/providers/google/push/receiver";

const CLAIM_KEYS = [
  "channelKey",
  "deliveryId",
  "kind",
  "lifecycleEvent",
  "presentedResourceId",
  "presentedSecret",
];

const makeRequest = (
  headers: Record<string, string>,
  body: unknown = null,
) => ({
  body,
  headers: new Headers(headers),
  url: new URL("https://www.example.com/api/webhook/google"),
});

const validHeaders = {
  "x-goog-channel-id": "3f1b0e5a-1111-4f2a-9c22-000000000001",
  "x-goog-channel-token": "b".repeat(64),
  "x-goog-message-number": "7",
  "x-goog-resource-id": "resource-1",
  "x-goog-resource-state": "exists",
};

describe("parseGooglePushNotification", () => {
  it("parses a change notification into exactly one claim", () => {
    const result = parseGooglePushNotification(makeRequest(validHeaders));

    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toEqual({
      channelKey: "3f1b0e5a-1111-4f2a-9c22-000000000001",
      deliveryId: "7",
      kind: "change",
      lifecycleEvent: null,
      presentedResourceId: "resource-1",
      presentedSecret: "b".repeat(64),
    });
  });

  it("marks the initial sync ping as its own kind", () => {
    const result = parseGooglePushNotification(makeRequest({
      ...validHeaders,
      "x-goog-message-number": "1",
      "x-goog-resource-state": "sync",
    }));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims[0]?.kind).toBe("sync");
  });

  it("carries no delivery id when Google omits the message number", () => {
    const { "x-goog-message-number": _messageNumber, ...withoutNumber } = validHeaders;

    const result = parseGooglePushNotification(makeRequest(withoutNumber));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    expect(result.claims[0]?.deliveryId).toBeNull();
  });

  it("refuses a notification with no channel token", () => {
    const { "x-goog-channel-token": _token, ...withoutToken } = validHeaders;

    expect(parseGooglePushNotification(makeRequest(withoutToken)).ok).toBe(false);
  });

  it("refuses a notification with no channel id", () => {
    const { "x-goog-channel-id": _channelId, ...withoutChannel } = validHeaders;

    expect(parseGooglePushNotification(makeRequest(withoutChannel)).ok).toBe(false);
  });

  it("never exposes a calendar identifier, even when the body names one", () => {
    const result = parseGooglePushNotification(makeRequest(
      validHeaders,
      { calendarId: "cal-999", userId: "user-999" },
    ));

    if (!result.ok || result.kind !== "notification") {
      throw new Error("expected a parsed notification");
    }
    for (const claim of result.claims) {
      expect(Object.keys(claim).toSorted()).toEqual(CLAIM_KEYS);
    }
    expect(JSON.stringify(result)).not.toContain("cal-999");
    expect(JSON.stringify(result)).not.toContain("user-999");
  });

  it("does not throw on a hostile body", () => {
    expect(() => parseGooglePushNotification(makeRequest(validHeaders, "not-json")))
      .not.toThrow();
    expect(() => parseGooglePushNotification(makeRequest(validHeaders, [1, 2, 3])))
      .not.toThrow();
  });
});
