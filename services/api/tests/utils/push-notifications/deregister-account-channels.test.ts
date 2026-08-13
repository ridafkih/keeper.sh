import { describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterAccountPushChannels } from "../../../src/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-12T00:00:00.000Z");

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

const makeRegistrar = (
  deregister: DeregisterMock = vi.fn<DeregisterMock>(() => Promise.resolve()),
) => ({
  deregister,
  maxLifetimeMs: 604_800_000,
  provider: "google",
  register: vi.fn(),
  renew: vi.fn(),
  renewalMode: "recreate" as const,
  resolveAffectedCalendarIds: vi.fn(),
  scopeKind: "calendar" as const,
  supportsList: false,
});

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  createRegistrarContext: vi.fn(() => Promise.resolve({
    accessToken: "token",
    channelId: "google-channel-1",
    fetchImpl: globalThis.fetch,
    notificationUrl: "https://example.com/api/webhook/google",
    now: NOW,
    requestedExpiresAt: NOW,
  })),
  listLiveChannels: vi.fn(() => Promise.resolve([makeChannel()])),
  observe: vi.fn(),
  recordError: vi.fn(),
  resolveRegistrar: vi.fn(() => makeRegistrar()),
  webhookConfigured: true,
  ...overrides,
});

describe("runDeregisterAccountPushChannels when push is unconfigured", () => {
  it("performs no work at all", async () => {
    const dependencies = makeDependencies({ webhookConfigured: false });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(0);

    expect(dependencies.listLiveChannels).not.toHaveBeenCalled();
    expect(dependencies.createRegistrarContext).not.toHaveBeenCalled();
    expect(dependencies.resolveRegistrar).not.toHaveBeenCalled();
  });
});

describe("runDeregisterAccountPushChannels", () => {
  it("stops every live channel owned by the account", async () => {
    const deregister = vi.fn<DeregisterMock>(() => Promise.resolve());
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({ id: "channel-2", providerChannelId: "google-channel-2" }),
      ])),
      resolveRegistrar: vi.fn(() => makeRegistrar(deregister)),
    });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(2);

    expect(dependencies.listLiveChannels).toHaveBeenCalledWith("account-1");
    expect(deregister).toHaveBeenCalledTimes(2);
    expect(deregister.mock.calls.map(([channel]) => channel.providerChannelId))
      .toEqual(["google-channel-1", "google-channel-2"]);
  });

  it("reports a provider failure and still proceeds with the remaining channels", async () => {
    const deregister = vi.fn<DeregisterMock>((channel) => {
      if (channel.providerChannelId === "google-channel-1") {
        return Promise.reject(new Error("graph unavailable"));
      }
      return Promise.resolve();
    });
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ id: "channel-1", providerChannelId: "google-channel-1" }),
        makeChannel({ id: "channel-2", providerChannelId: "google-channel-2" }),
      ])),
      resolveRegistrar: vi.fn(() => makeRegistrar(deregister)),
    });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(1);

    expect(deregister).toHaveBeenCalledTimes(2);
    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe("webhook-deregistration-failed");
  });

  it("never throws when the channel lookup itself fails", async () => {
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.reject(new Error("database down"))),
    });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(0);

    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe("webhook-deregistration-failed");
  });

  it("skips a row the provider could never have created", async () => {
    const deregister = vi.fn<DeregisterMock>(() => Promise.resolve());
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([
        makeChannel({ providerChannelId: null, state: "registering" }),
      ])),
      resolveRegistrar: vi.fn(() => makeRegistrar(deregister)),
    });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(0);

    expect(deregister).not.toHaveBeenCalled();
  });

  it("skips a provider with no registered push implementation", async () => {
    const dependencies = makeDependencies({
      listLiveChannels: vi.fn(() => Promise.resolve([makeChannel({ provider: "caldav" })])),
      resolveRegistrar: vi.fn(() => null),
    });

    await expect(
      runDeregisterAccountPushChannels("account-1", dependencies),
    ).resolves.toBe(0);

    expect(dependencies.createRegistrarContext).not.toHaveBeenCalled();
  });
});
