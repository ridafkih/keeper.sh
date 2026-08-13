import { describe, expect, it, vi } from "vitest";
import {
  registerGoogleWatchChannel,
  stopGoogleWatchChannel,
} from "../../../../src/providers/google/push/watch-channel";
import type {
  PushChannelScope,
  RegistrarContext,
  StoredPushChannel,
} from "../../../../src/core/source/push-channel";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * HOUR_MS;
const SECRET = "b".repeat(64);

const scope: PushChannelScope = {
  accountId: "account-1",
  calendarId: "cal-1",
  externalCalendarId: "primary@example.com",
  kind: "calendar",
  providerAccountId: "provider-account-1",
  userId: "user-1",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const makeContext = (
  fetchImpl: typeof fetch,
  overrides: Partial<RegistrarContext> = {},
): RegistrarContext => ({
  accessToken: "access-token-1",
  channelId: "5b0e0d3c-2222-4a1b-8f33-000000000002",
  fetchImpl,
  notificationUrl: "https://www.example.com/api/webhook/google",
  now: NOW,
  requestedExpiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  ...overrides,
});

describe("registerGoogleWatchChannel", () => {
  it("posts a web_hook watch request for the external calendar", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({
      expiration: String(NOW.getTime() + SEVEN_DAYS_MS),
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
      resourceId: "google-resource-1",
      resourceUri: "https://www.googleapis.com/calendar/v3/calendars/primary%40example.com/events",
    })));

    await registerGoogleWatchChannel(scope, SECRET, makeContext(fetchImpl as unknown as typeof fetch));

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary%40example.com/events/watch",
    );
    expect(init.method).toBe("POST");
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      address: "https://www.example.com/api/webhook/google",
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
      token: SECRET,
      type: "web_hook",
    });
    expect(Number(payload.params.ttl)).toBeGreaterThan(0);
    expect(Number(payload.params.ttl)).toBeLessThanOrEqual(SEVEN_DAYS_MS / 1000);
  });

  it("persists the provider-returned expiration rather than the requested ttl", async () => {
    const providerExpiration = NOW.getTime() + 6 * HOUR_MS;
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({
      expiration: String(providerExpiration),
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
      resourceId: "google-resource-1",
    })));

    const registration = await registerGoogleWatchChannel(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    expect(registration.expiresAt.getTime()).toBe(providerExpiration);
    expect(registration.providerChannelId).toBe("5b0e0d3c-2222-4a1b-8f33-000000000002");
    expect(registration.providerResourceId).toBe("google-resource-1");
  });

  it("refuses a response with no resource id rather than storing an unstoppable channel", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({
      expiration: String(NOW.getTime() + SEVEN_DAYS_MS),
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
    })));

    await expect(registerGoogleWatchChannel(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toThrow();
  });

  it("refuses a response with no expiration", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
      resourceId: "google-resource-1",
    })));

    await expect(registerGoogleWatchChannel(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toThrow();
  });

  it("acquires from the shared per-user rate limiter before issuing the request", async () => {
    const callLog: string[] = [];
    const acquire = vi.fn(() => {
      callLog.push("acquire");
      return Promise.resolve();
    });
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => {
      callLog.push("fetch");
      return Promise.resolve(jsonResponse({
        expiration: String(NOW.getTime() + SEVEN_DAYS_MS),
        id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
        resourceId: "google-resource-1",
      }));
    });

    await registerGoogleWatchChannel(scope, SECRET, makeContext(
      fetchImpl as unknown as typeof fetch,
      { rateLimiter: { acquire } },
    ));

    expect(callLog).toEqual(["acquire", "fetch"]);
  });

  it("surfaces a provider error rather than resolving", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(
      { error: { code: 403, message: "quotaExceeded" } },
      403,
    )));

    await expect(registerGoogleWatchChannel(
      scope,
      SECRET,
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toThrow();
  });
});

const makeStoredChannel = (): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "5b0e0d3c-2222-4a1b-8f33-000000000002",
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary%40example.com/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
});

describe("stopGoogleWatchChannel", () => {
  it("posts the channel id and resource id to the channels stop endpoint", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })));

    await stopGoogleWatchChannel(
      makeStoredChannel(),
      makeContext(fetchImpl as unknown as typeof fetch),
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://www.googleapis.com/calendar/v3/channels/stop");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "5b0e0d3c-2222-4a1b-8f33-000000000002",
      resourceId: "google-resource-1",
    });
  });

  it("treats an already-gone channel as stopped rather than as a failure", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 404 })));

    await expect(stopGoogleWatchChannel(
      makeStoredChannel(),
      makeContext(fetchImpl as unknown as typeof fetch),
    )).resolves.toBeUndefined();
  });

  it("surfaces a genuine stop failure", async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 500 })));

    await expect(stopGoogleWatchChannel(
      makeStoredChannel(),
      makeContext(fetchImpl as unknown as typeof fetch),
    )).rejects.toThrow();
  });
});
