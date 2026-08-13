import { describe, expect, it, vi } from "vitest";
import {
  deregisterOutlookSubscription,
  listOutlookSubscriptions,
  registerOutlookSubscription,
  renewOutlookSubscription,
} from "../../../../src/providers/outlook/push/subscription";
import type {
  PushChannelScope,
  RegistrarContext,
  StoredPushChannel,
} from "../../../../src/core/source/push-channel";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const MINUTE_MS = 60 * 1000;
const GRAPH_MAX_LIFETIME_MS = 10_080 * MINUTE_MS;
const SECRET = "c".repeat(64);

const scope: PushChannelScope = {
  accountId: "account-1",
  calendarId: "cal-1",
  externalCalendarId: "AAMkAGI2-calendar-id",
  kind: "calendar",
  providerAccountId: "00000000-1111-2222-3333-444444444444",
  userId: "user-1",
};

const channel = {
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 20 * 60 * MINUTE_MS),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "outlook",
  providerChannelId: "graph-subscription-1",
  providerResourceId: null,
  reauthorizeRequestedAt: null,
  resourcePath: "/users/00000000-1111-2222-3333-444444444444/calendars/AAMkAGI2-calendar-id/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
} satisfies StoredPushChannel;

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const subscriptionBody = (expirationDateTime: string) => ({
  changeType: "created,updated,deleted",
  clientState: SECRET,
  expirationDateTime,
  id: "graph-subscription-1",
  notificationUrl: "https://www.example.com/api/webhook/outlook",
  resource: "/users/00000000-1111-2222-3333-444444444444/calendars/AAMkAGI2-calendar-id/events",
});

const makeContext = (
  fetchImpl: typeof fetch,
  overrides: Partial<RegistrarContext> = {},
): RegistrarContext => ({
  accessToken: "access-token-1",
  channelId: null,
  fetchImpl,
  notificationUrl: "https://www.example.com/api/webhook/outlook",
  now: NOW,
  requestedExpiresAt: new Date(NOW.getTime() + GRAPH_MAX_LIFETIME_MS),
  ...overrides,
});

describe("registerOutlookSubscription", () => {
  it("creates a per-calendar subscription inside the Graph lifetime cap", async () => {
    const expiration = new Date(NOW.getTime() + 10_000 * MINUTE_MS).toISOString();
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(subscriptionBody(expiration))));

    const registration = await registerOutlookSubscription(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/subscriptions");
    expect(init.method).toBe("POST");

    const payload = JSON.parse(String(init.body));
    expect(payload.resource).toBe(
      "/users/00000000-1111-2222-3333-444444444444/calendars/AAMkAGI2-calendar-id/events",
    );
    expect(payload.changeType).toBe("created,updated,deleted");
    expect(payload.clientState).toBe(SECRET);
    expect(payload.notificationUrl).toBe("https://www.example.com/api/webhook/outlook");
    expect(payload.lifecycleNotificationUrl).toBe("https://www.example.com/api/webhook/outlook");
    expect("includeResourceData" in payload).toBe(false);
    expect(new Date(payload.expirationDateTime).getTime())
      .toBeLessThan(NOW.getTime() + GRAPH_MAX_LIFETIME_MS);

    expect(registration.expiresAt.toISOString()).toBe(new Date(expiration).toISOString());
    expect(registration.providerChannelId).toBe("graph-subscription-1");
  });

  it("surfaces a 409 as a distinguishable duplicate outcome", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(
      { error: { code: "SubscriptionAlreadyExists", message: "duplicate" } },
      409,
    )));

    await expect(registerOutlookSubscription(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toMatchObject({ duplicate: true });
  });

  it("surfaces other provider errors without the duplicate marker", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(
      { error: { code: "InvalidRequest", message: "bad resource" } },
      400,
    )));

    await expect(registerOutlookSubscription(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.not.toMatchObject({ duplicate: true });
  });
});

describe("renewOutlookSubscription", () => {
  it("extends with a single PATCH carrying only the new expiry", async () => {
    const expiration = new Date(NOW.getTime() + 10_000 * MINUTE_MS).toISOString();
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(subscriptionBody(expiration))));

    const registration = await renewOutlookSubscription(
      channel,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/subscriptions/graph-subscription-1");
    expect(init.method).toBe("PATCH");
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["expirationDateTime"]);
    expect(registration.providerChannelId).toBe("graph-subscription-1");
  });

  it("marks a vanished subscription as gone so the caller can re-register", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(
      { error: { code: "ResourceNotFound", message: "subscription not found" } },
      404,
    )));

    await expect(renewOutlookSubscription(
      channel,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toMatchObject({ channelGone: true });
  });

  it("does not mark a throttled renewal as gone", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(
      { error: { code: "TooManyRequests", message: "throttled" } },
      429,
    )));

    await expect(renewOutlookSubscription(
      channel,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toMatchObject({ channelGone: false });
  });

  it("never calls the reauthorize endpoint", async () => {
    const expiration = new Date(NOW.getTime() + 10_000 * MINUTE_MS).toISOString();
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(subscriptionBody(expiration))));

    await renewOutlookSubscription(
      channel,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    for (const [url] of fetchImpl.mock.calls as [string, RequestInit][]) {
      expect(String(url)).not.toContain("reauthorize");
    }
  });
});

describe("deregisterOutlookSubscription", () => {
  it("deletes the subscription by its provider id", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));

    await deregisterOutlookSubscription(
      channel,
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/subscriptions/graph-subscription-1");
    expect(init.method).toBe("DELETE");
  });
});

describe("listOutlookSubscriptions", () => {
  it("lists the account's subscriptions for drift reconciliation", async () => {
    const expiration = new Date(NOW.getTime() + 10_000 * MINUTE_MS).toISOString();
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({
      value: [subscriptionBody(expiration)],
    })));

    const subscriptions = await listOutlookSubscriptions(
      "account-1",
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/subscriptions");
    expect(subscriptions.map((subscription) => subscription.providerChannelId))
      .toEqual(["graph-subscription-1"]);
  });
});
