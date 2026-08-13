import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import type { handleOutlookPushWebhook as handleOutlookPushWebhookFn } from "../../../../src/routes/api/webhook/outlook";

let handleOutlookPushWebhook: typeof handleOutlookPushWebhookFn = () =>
  Promise.reject(new Error("Module not loaded"));

const NOW = new Date("2026-08-12T00:00:00.000Z");
const WEBHOOK_URL = "https://www.example.com";

const makeChannel = (
  overrides: Partial<StoredPushChannel> = {},
): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "outlook",
  providerChannelId: "sub-1",
  providerResourceId: null,
  reauthorizeRequestedAt: null,
  resourcePath: "/users/u1/calendars/c1/events",
  secretHash: "hash-of-secret-1",
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
  ...overrides,
});

const channelsByKey = new Map<string, StoredPushChannel>([
  ["sub-1", makeChannel()],
  ["sub-2", makeChannel({
    accountId: "account-2",
    calendarId: "cal-2",
    id: "channel-2",
    providerChannelId: "sub-2",
    secretHash: "hash-of-secret-2",
    userId: "user-2",
  })],
  ["sub-3", makeChannel({
    calendarId: "cal-3",
    id: "channel-3",
    providerChannelId: "sub-3",
    secretHash: "hash-of-secret-3",
  })],
  ["sub-bad", makeChannel({
    calendarId: "cal-bad",
    id: "channel-bad",
    providerChannelId: "sub-bad",
    secretHash: "hash-of-secret-bad",
  })],
]);

const changeEntry = (
  subscriptionId: string,
  clientState: string,
  resource = "/users/u1/calendars/cal-999/events/e1",
) => ({
  changeType: "updated",
  clientState,
  resource,
  resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: `event-${subscriptionId}` },
  subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
  subscriptionId,
  tenantId: "tenant-1",
});

const lifecycleEntry = (
  subscriptionId: string,
  clientState: string,
  lifecycleEvent: string,
) => ({
  clientState,
  lifecycleEvent,
  subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
  subscriptionId,
  tenantId: "tenant-1",
});

const makeRequest = (
  body: unknown,
  url = "https://www.example.com/api/webhook/outlook",
): Request => {
  if (body === null) {
    return new Request(url, { method: "POST" });
  }
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
};

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimDelivery: vi.fn(() => Promise.resolve(true)),
  claimPushAdmission: vi.fn((_input: { channelKey: string | null; provider: string }) =>
    Promise.resolve(true)),
  findChannel: vi.fn((_provider: string, channelKey: string) =>
    Promise.resolve(channelsByKey.get(channelKey) ?? null)),
  isUnknownChannelCached: vi.fn(() => Promise.resolve(false)),
  markChannelRemoved: vi.fn(() => Promise.resolve()),
  markPendingIngest: vi.fn(() => Promise.resolve()),
  markReauthorizeRequested: vi.fn(() => Promise.resolve()),
  observe: vi.fn(),
  recordNotificationReceived: vi.fn(),
  recordVerified: vi.fn(() => Promise.resolve()),
  rememberUnknownChannel: vi.fn(() => Promise.resolve()),
  resetSyncToken: vi.fn(() => Promise.resolve()),
  resolveAffectedCalendarIds: vi.fn((channel: StoredPushChannel) =>
    Promise.resolve([channel.calendarId].filter((id) => id !== null))),
  resolveRegistrar: vi.fn(),
  verifySecret: vi.fn((presented: string, storedHash: string) =>
    storedHash === `hash-of-${presented}`),
  webhookPublicUrl: WEBHOOK_URL,
  ...overrides,
});

const observedFields = (
  observe: ReturnType<typeof vi.fn>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const call of observe.mock.calls) {
    Object.assign(merged, call[0]);
  }
  return merged;
};

const markedCalendarIds = (
  markPendingIngest: ReturnType<typeof vi.fn>,
): string[] =>
  markPendingIngest.mock.calls.flatMap((call) => call[0] as string[]).toSorted();

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/context", () => ({
  database: {},
  premiumService: {},
  redis: {},
}));
vi.mock("../../../../src/env", () => ({ default: {} }));
vi.mock("../../../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

beforeAll(async () => {
  ({ handleOutlookPushWebhook } = await import("../../../../src/routes/api/webhook/outlook"));
});

describe("handleOutlookPushWebhook validation handshake", () => {
  it("answers the handshake before any dependency is consulted", async () => {
    const dependencies = makeDependencies({ webhookPublicUrl: null });

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest(
          null,
          "https://www.example.com/api/webhook/outlook?validationToken=abc%20def",
        ),
      },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("abc def");

    for (const [name, dependency] of Object.entries(dependencies)) {
      if (typeof dependency === "function" && name !== "observe") {
        expect(dependency).not.toHaveBeenCalled();
      }
    }
  });

  it("echoes a hostile-looking token verbatim rather than escaping it", async () => {
    const dependencies = makeDependencies();
    const token = "<script>alert(1)</script>";

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest(
          null,
          `https://www.example.com/api/webhook/outlook?validationToken=${encodeURIComponent(token)}`,
        ),
      },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(token);
  });

  it("refuses an oversized handshake token without echoing it", async () => {
    const dependencies = makeDependencies();
    const token = "z".repeat(4096);

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest(
          null,
          `https://www.example.com/api/webhook/outlook?validationToken=${token}`,
        ),
      },
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(token);
  });
});

describe("handleOutlookPushWebhook batches", () => {
  it("verifies each batch element independently", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [
            changeEntry("sub-1", "secret-1"),
            changeEntry("sub-bad", "wrong-secret"),
            changeEntry("sub-3", "secret-3"),
          ],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1", "cal-3"]);
    expect(observedFields(dependencies.observe)["webhook.rejected_count"]).toBe(1);
    expect(observedFields(dependencies.observe)["webhook.notification_count"]).toBe(3);
  });

  it("resolves each subscription only to its own row's calendars", async () => {
    const dependencies = makeDependencies();

    await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [
            changeEntry("sub-1", "secret-1", "/users/u9/calendars/cal-999/events/e1"),
            changeEntry("sub-2", "secret-2", "/users/u9/calendars/cal-999/events/e2"),
          ],
        }),
      },
      dependencies,
    );

    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1", "cal-2"]);
    expect(markedCalendarIds(dependencies.markPendingIngest)).not.toContain("cal-999");
    for (const [channel] of dependencies.resolveAffectedCalendarIds.mock.calls) {
      expect(["channel-1", "channel-2"]).toContain((channel as StoredPushChannel).id);
    }
  });

  it("looks a subscription up once however many elements it carries", async () => {
    const dependencies = makeDependencies();
    const value = Array.from({ length: 40 }, (_unused, index) => ({
      ...changeEntry("sub-1", "secret-1"),
      id: `notification-${index}`,
    }));

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ value }) },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(dependencies.isUnknownChannelCached).toHaveBeenCalledOnce();
    expect(dependencies.findChannel).toHaveBeenCalledOnce();
    expect(dependencies.resolveAffectedCalendarIds).toHaveBeenCalledOnce();
    expect(dependencies.markPendingIngest).toHaveBeenCalledOnce();
    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1"]);
  });

  it("writes verification and liveness once per subscription in a batch", async () => {
    const dependencies = makeDependencies();
    const value = Array.from({ length: 40 }, (_unused, index) => ({
      ...changeEntry("sub-1", "secret-1"),
      id: `notification-${index}`,
    }));

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ value }) },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(dependencies.recordVerified).toHaveBeenCalledOnce();
    expect(dependencies.recordNotificationReceived).toHaveBeenCalledOnce();
  });

  it("never builds an admission key from an unbounded subscription id", async () => {
    const dependencies = makeDependencies();
    const oversizedSubscriptionId = "s".repeat(4096);

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [changeEntry(oversizedSubscriptionId, "secret-1")],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(401);
    for (const [input] of dependencies.claimPushAdmission.mock.calls) {
      expect((input as { channelKey: string | null }).channelKey).toBeNull();
    }
  });

  it("still verifies every element even when they share a subscription", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [
            { ...changeEntry("sub-1", "secret-1"), id: "notification-1" },
            { ...changeEntry("sub-1", "wrong-secret"), id: "notification-2" },
          ],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(dependencies.verifySecret).toHaveBeenCalledTimes(2);
    expect(observedFields(dependencies.observe)["webhook.rejected_count"]).toBe(1);
    expect(dependencies.claimDelivery).toHaveBeenCalledOnce();
  });

  it("does not claim a delivery for an element that failed verification", async () => {
    const dependencies = makeDependencies();

    await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [changeEntry("sub-bad", "wrong-secret")],
        }),
      },
      dependencies,
    );

    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });

  it("suppresses a replay of the same Graph notification id", async () => {
    const seen = new Set<string>();
    const dependencies = makeDependencies({
      claimDelivery: vi.fn((key: string) => {
        if (seen.has(key)) {
          return Promise.resolve(false);
        }
        seen.add(key);
        return Promise.resolve(true);
      }),
    });

    const payload = {
      value: [
        { ...changeEntry("sub-1", "secret-1"), id: "notification-1" },
        { ...changeEntry("sub-3", "secret-3"), id: "notification-2" },
      ],
    };

    await handleOutlookPushWebhook({ request: makeRequest(payload) }, dependencies);
    dependencies.markPendingIngest.mockClear();
    const replay = await handleOutlookPushWebhook(
      { request: makeRequest(payload) },
      dependencies,
    );

    expect(replay.status).toBe(202);
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });

  it("never suppresses a later change to the same event", async () => {
    const seen = new Set<string>();
    const dependencies = makeDependencies({
      claimDelivery: vi.fn((key: string) => {
        if (seen.has(key)) {
          return Promise.resolve(false);
        }
        seen.add(key);
        return Promise.resolve(true);
      }),
    });

    const deliver = (notificationId: string): Promise<Response> => handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [{ ...changeEntry("sub-1", "secret-1"), id: notificationId }],
        }),
      },
      dependencies,
    );

    await deliver("notification-1");
    dependencies.markPendingIngest.mockClear();
    await deliver("notification-2");

    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1"]);
  });

  it("ingests every delivery when Graph omits the notification id", async () => {
    const dependencies = makeDependencies();

    const deliver = (): Promise<Response> => handleOutlookPushWebhook(
      { request: makeRequest({ value: [changeEntry("sub-1", "secret-1")] }) },
      dependencies,
    );

    await deliver();
    dependencies.markPendingIngest.mockClear();
    await deliver();

    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1"]);
  });

  it("refuses a malformed body with 400 and no lookups", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ notAValueArray: true }) },
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(dependencies.findChannel).not.toHaveBeenCalled();
  });

  it("returns an indistinguishable 401 when the whole batch is unauthorised", async () => {
    const unknownDependencies = makeDependencies();
    const mismatchDependencies = makeDependencies();

    const unknown = await handleOutlookPushWebhook(
      { request: makeRequest({ value: [changeEntry("sub-unknown", "secret-1")] }) },
      unknownDependencies,
    );
    const mismatch = await handleOutlookPushWebhook(
      { request: makeRequest({ value: [changeEntry("sub-1", "wrong-secret")] }) },
      mismatchDependencies,
    );

    expect(unknown.status).toBe(401);
    expect(mismatch.status).toBe(401);
    expect(await unknown.text()).toBe(await mismatch.text());
    expect([...unknown.headers.entries()].toSorted())
      .toEqual([...mismatch.headers.entries()].toSorted());
  });
});

describe("handleOutlookPushWebhook lifecycle events", () => {
  it("records a removed subscription and still recovers the lost window", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [lifecycleEntry("sub-1", "secret-1", "subscriptionRemoved")],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(dependencies.markChannelRemoved).toHaveBeenCalledWith("channel-1");
    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1"]);
    expect(dependencies.resolveRegistrar).not.toHaveBeenCalled();
    expect(dependencies.resetSyncToken).not.toHaveBeenCalled();
  });

  it("flags a reauthorization request without contacting the provider", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [lifecycleEntry("sub-1", "secret-1", "reauthorizationRequired")],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(dependencies.markReauthorizeRequested).toHaveBeenCalledWith("channel-1");
    expect(dependencies.resolveRegistrar).not.toHaveBeenCalled();
    expect(dependencies.resetSyncToken).not.toHaveBeenCalled();
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });

  it("recovers missed notifications without resetting the sync token", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ value: [lifecycleEntry("sub-1", "secret-1", "missed")] }) },
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(markedCalendarIds(dependencies.markPendingIngest)).toEqual(["cal-1"]);
    expect(dependencies.resetSyncToken).not.toHaveBeenCalled();
    expect(dependencies.resolveRegistrar).not.toHaveBeenCalled();
  });

  it("verifies a lifecycle element's client state like any other", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      {
        request: makeRequest({
          value: [lifecycleEntry("sub-1", "wrong-secret", "subscriptionRemoved")],
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(dependencies.markChannelRemoved).not.toHaveBeenCalled();
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });
});

describe("handleOutlookPushWebhook when push is unconfigured", () => {
  it("returns 501 for a real notification and performs no work", async () => {
    const dependencies = makeDependencies({ webhookPublicUrl: null });

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ value: [changeEntry("sub-1", "secret-1")] }) },
      dependencies,
    );

    expect(response.status).toBe(501);
    expect(dependencies.claimPushAdmission).not.toHaveBeenCalled();
    expect(dependencies.findChannel).not.toHaveBeenCalled();
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });
});

describe("handleOutlookPushWebhook failure handling", () => {
  it("fails closed with 503 so Graph redelivers", async () => {
    const dependencies = makeDependencies({
      markPendingIngest: vi.fn(() => Promise.reject(new Error("redis down"))),
    });

    const response = await handleOutlookPushWebhook(
      { request: makeRequest({ value: [changeEntry("sub-1", "secret-1")] }) },
      dependencies,
    );

    expect(response.status).toBe(503);
  });
});
