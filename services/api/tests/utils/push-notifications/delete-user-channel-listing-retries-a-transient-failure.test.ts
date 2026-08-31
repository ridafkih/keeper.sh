import { describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import type { DeregisterPushChannelsDependencies } from "@/utils/push-notifications/deregister-account-channels";
import { runDeregisterPushChannelsOutcome } from "@/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const DISCONNECT_CONCURRENCY = 8;
const TRANSIENT_LISTING_FAILURE = "db blip: ECONNRESET";

const makeChannel = (overrides: Partial<StoredPushChannel> = {}): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 60_000),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-channel-1",
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: NOW,
  ...overrides,
});

const makeRegistrar = (provider: string) => ({
  deregister: vi.fn(() => Promise.resolve()),
  maxLifetimeMs: 604_800_000,
  provider,
  register: vi.fn(),
  renew: vi.fn(),
  renewalMode: "recreate" as const,
  resolveAffectedCalendarIds: vi.fn(),
  scopeKind: "calendar" as const,
  supportsList: false,
});

const makeDependencies = () => {
  const listLiveChannels = vi.fn<(scopeId: string) => Promise<StoredPushChannel[]>>()
    .mockRejectedValueOnce(new Error(TRANSIENT_LISTING_FAILURE))
    .mockResolvedValueOnce([makeChannel()]);

  const dependencies = {
    createRegistrarContext: vi.fn((channel: StoredPushChannel) => Promise.resolve({
      accessToken: "token",
      channelId: channel.providerChannelId,
      fetchImpl: globalThis.fetch,
      notificationUrl: "https://example.com/api/webhook/google",
      now: NOW,
      requestedExpiresAt: NOW,
    })),
    listLiveChannels,
    markChannelsStopped: vi.fn(() => Promise.resolve()),
    observe: vi.fn(),
    recordError: vi.fn(),
    resolveRegistrar: vi.fn((provider: string) => makeRegistrar(provider)),
    webhookConfigured: true,
  };

  return dependencies as unknown as DeregisterPushChannelsDependencies & typeof dependencies;
};

describe("a delete-user push channel listing that blips once", () => {
  it("retries the listing and deregisters the channel normally", async () => {
    const dependencies = makeDependencies();

    const outcome = await runDeregisterPushChannelsOutcome(
      "user-1",
      dependencies,
      null,
      DISCONNECT_CONCURRENCY,
      true,
    );

    expect(dependencies.listLiveChannels).toHaveBeenCalledTimes(2);
    expect(outcome.deregisteredCount).toBe(1);
    expect(outcome.abandonments).toEqual([]);
    expect(dependencies.observe).toHaveBeenCalledTimes(1);
    expect(dependencies.observe.mock.calls[0]?.[0]).toMatchObject({
      "push_channel.disconnect_abandoned_count": 0,
      "push_channel.disconnect_deregistered_count": 1,
    });
  });
});
