import { describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import {
  DEREGISTRATION_FAILED_SLUG,
  deregisterUserPushChannels,
  runDeregisterUserPushChannels,
} from "../../../src/utils/push-notifications/deregister-account-channels";

const deregistration: Record<string, unknown> = {
  DEREGISTRATION_FAILED_SLUG,
  deregisterUserPushChannels,
  runDeregisterUserPushChannels,
};

const NOW = new Date("2026-08-25T06:15:33.956Z");

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

type DeregisterMock = (channel: StoredPushChannel) => Promise<void>;

const makeRegistrar = (provider: string, deregister: DeregisterMock) => ({
  deregister,
  maxLifetimeMs: 604_800_000,
  provider,
  register: vi.fn(),
  renew: vi.fn(),
  renewalMode: "recreate" as const,
  resolveAffectedCalendarIds: vi.fn(),
  scopeKind: "calendar" as const,
  supportsList: false,
});

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  createRegistrarContext: vi.fn((channel: StoredPushChannel) => Promise.resolve({
    accessToken: "token",
    channelId: channel.providerChannelId,
    fetchImpl: globalThis.fetch,
    notificationUrl: "https://example.com/api/webhook/google",
    now: NOW,
    requestedExpiresAt: NOW,
  })),
  listLiveChannels: vi.fn(() => Promise.resolve([makeChannel()])),
  observe: vi.fn(),
  recordError: vi.fn(),
  resolveRegistrar: vi.fn((provider: string) =>
    makeRegistrar(provider, vi.fn<DeregisterMock>(() => Promise.resolve()))),
  webhookConfigured: true,
  ...overrides,
});

const resolveUserRunner = () => {
  const runner = deregistration.runDeregisterUserPushChannels;

  expect(runner).toBeTypeOf("function");

  return runner as (
    userId: string,
    dependencies: ReturnType<typeof makeDependencies>,
  ) => Promise<number>;
};

describe("push channel teardown for a deleted user", () => {
  it("exposes a user scoped deregistration entry point for delete teardown", () => {
    expect(deregistration.deregisterUserPushChannels)
      .toBeTypeOf("function");
  });

  it("deregisters every live channel the user owns across providers", async () => {
    const deregisterGoogle = vi.fn<DeregisterMock>(() => Promise.resolve());
    const deregisterOutlook = vi.fn<DeregisterMock>(() => Promise.resolve());
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({
          accountId: "account-2",
          calendarId: "cal-2",
          id: "channel-2",
          provider: "outlook",
          providerChannelId: "graph-subscription-1",
        }),
      ])),
      resolveRegistrar: vi.fn((provider: string) =>
        makeRegistrar(provider, { google: deregisterGoogle, outlook: deregisterOutlook }[provider] ?? deregisterOutlook)),
    });

    await expect(resolveUserRunner()("user-1", dependencies)).resolves.toBe(2);

    expect(dependencies.listLiveChannels).toHaveBeenCalledWith("user-1");
    expect(deregisterGoogle.mock.calls.map(([channel]) => channel.providerChannelId))
      .toEqual(["google-channel-1"]);
    expect(deregisterOutlook.mock.calls.map(([channel]) => channel.providerChannelId))
      .toEqual(["graph-subscription-1"]);
  });

  it("attempts every remaining channel when one provider call throws", async () => {
    const attempted: string[] = [];
    const deregister = vi.fn<DeregisterMock>((channel) => {
      attempted.push(String(channel.providerChannelId));
      if (channel.providerChannelId === "google-channel-2") {
        return Promise.reject(new Error("watch channel already gone"));
      }
      return Promise.resolve();
    });
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({ id: "channel-2", providerChannelId: "google-channel-2" }),
        makeChannel({ id: "channel-3", providerChannelId: "google-channel-3" }),
      ])),
      resolveRegistrar: vi.fn((provider: string) => makeRegistrar(provider, deregister)),
    });

    await expect(resolveUserRunner()("user-1", dependencies)).resolves.toBe(2);

    expect(attempted).toEqual([
      "google-channel-1",
      "google-channel-2",
      "google-channel-3",
    ]);

    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe(deregistration.DEREGISTRATION_FAILED_SLUG);
    expect(dependencies.observe).toHaveBeenCalledWith(expect.objectContaining({
      "push_channel.disconnect_deregistered_count": 2,
      "push_channel.disconnect_live_count": 3,
    }));
  });
});
