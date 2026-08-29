import { describe, expect, it, vi } from "vitest";
import {
  runManagePushChannels,
  type RegistrarContextRequest,
} from "../../../src/core/source/manage-push-channels";
import { resolvePushRegistrar } from "../../../src/core/source/push-registry";
import type { StoredPushChannel } from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const WEBHOOK_URL = "https://www.example.com";

const halfRegisteredChannel = (): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: null,
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "generated-channel-id",
  providerResourceId: null,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: "a".repeat(64),
  state: "registering",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
});

const makeDependencies = () => {
  const registrar = resolvePushRegistrar("google");
  if (!registrar) {
    throw new Error("the google push registrar must resolve");
  }

  const fetchImpl = vi.fn(() => {
    throw new Error("the provider must not be dialed for an unstoppable channel");
  });

  return {
    createRegistrarContext: vi.fn((request: RegistrarContextRequest) => Promise.resolve({
      accessToken: "access-token-1",
      channelId: request.channelId,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      notificationUrl: `${WEBHOOK_URL}/api/webhook/${request.provider}`,
      now: NOW,
      requestedExpiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
    })),
    deleteNegativeCacheKey: vi.fn(() => Promise.resolve()),
    fetchImpl,
    generateChannelId: vi.fn(() => "generated-channel-id"),
    generateSecret: vi.fn(() => "d".repeat(64)),
    insertChannel: vi.fn(() => Promise.reject(new Error("no registration is expected"))),
    now: () => NOW,
    observe: vi.fn(),
    readChannel: vi.fn(() => Promise.resolve(halfRegisteredChannel())),
    recordError: vi.fn(),
    releaseLock: vi.fn(() => Promise.resolve()),
    resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    resolveRegistrar: vi.fn(() => registrar),
    selectChannels: vi.fn(() => Promise.resolve([halfRegisteredChannel()])),
    selectEligibleCalendars: vi.fn(() => Promise.resolve([])),
    tryAcquireLock: vi.fn(() => Promise.resolve(true)),
    updateChannel: vi.fn((_channelId: string, _updates: Record<string, unknown>) => Promise.resolve()),
    webhookPublicUrl: WEBHOOK_URL,
  };
};

describe("cron deregister of a channel that can never be stopped at the provider", () => {
  it("retires the row on the first attempt without dialing the provider", async () => {
    const dependencies = makeDependencies();

    await runManagePushChannels(dependencies);

    expect(dependencies.fetchImpl).not.toHaveBeenCalled();
    expect(dependencies.updateChannel).toHaveBeenCalledTimes(1);

    const [updateCall] = dependencies.updateChannel.mock.calls;
    if (!updateCall) {
      throw new Error("updateChannel must have been called for the retired row");
    }

    const [channelId, updates] = updateCall;
    expect(channelId).toBe("channel-1");
    expect(updates.state).toBe("removed");
    expect(updates).not.toHaveProperty("failureCount");
    expect(updates).not.toHaveProperty("nextAttemptAt");
    expect(updates).not.toHaveProperty("lastFailureAt");
  });

  it("reports the retirement once under its own slug", async () => {
    const dependencies = makeDependencies();

    await runManagePushChannels(dependencies);

    expect(dependencies.recordError).toHaveBeenCalledTimes(1);
    const slugs = dependencies.recordError.mock.calls.map((call) => call[1] as string);
    expect(slugs).toEqual(["webhook-deregistration-unstoppable"]);
    expect(slugs).not.toContain("webhook-deregistration-failed");
  });
});
