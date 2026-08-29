import { describe, expect, it } from "vitest";
import { resolvePushRegistrar } from "@keeper.sh/calendar";
import type { SourcePushRegistrar, StoredPushChannel } from "@keeper.sh/calendar";
import {
  runDeregisterAccountPushChannels,
  runDeregisterUserPushChannels,
} from "../../../src/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_COUNT = 6;

const makeChannel = (index: number): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: `cal-${index}`,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 60_000),
  failureCount: 0,
  id: `channel-${index}`,
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: `google-channel-${index}`,
  providerResourceId: `google-resource-${index}`,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: NOW,
});

const makeChannels = (count: number): StoredPushChannel[] =>
  Array.from({ length: count }, (_value, index) => makeChannel(index));

interface OverlapProbe {
  peak: number;
  registrar: SourcePushRegistrar;
}

const makeOverlapProbe = (): OverlapProbe => {
  const probe = { inFlight: 0, peak: 0 };

  const googleRegistrar = resolvePushRegistrar("google");
  if (!googleRegistrar) {
    throw new Error("The google push registrar must exist for this test to mean anything");
  }

  const registrar: SourcePushRegistrar = {
    ...googleRegistrar,
    deregister: async () => {
      probe.inFlight += 1;
      probe.peak = Math.max(probe.peak, probe.inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      probe.inFlight -= 1;
    },
  };

  return {
    get peak() {
      return probe.peak;
    },
    registrar,
  };
};

const makeDependencies = (
  registrar: SourcePushRegistrar,
  observedFields: Record<string, unknown>[],
) => ({
  createRegistrarContext: (channel: StoredPushChannel) => Promise.resolve({
    accessToken: "token",
    channelId: channel.providerChannelId,
    fetchImpl: globalThis.fetch,
    notificationUrl: "https://example.com/api/webhook/google",
    now: NOW,
    requestedExpiresAt: NOW,
  }),
  listLiveChannels: () => Promise.resolve(makeChannels(CHANNEL_COUNT)),
  markChannelsStopped: () => Promise.resolve(),
  observe: (fields: Record<string, unknown>) => {
    observedFields.push(fields);
  },
  recordError: (error: unknown) => {
    throw error;
  },
  resolveRegistrar: () => registrar,
  webhookConfigured: true,
});

describe("push channel deregistration fan-out per call site", () => {
  it("keeps account disconnect serial at the provider", async () => {
    const probe = makeOverlapProbe();
    const observedFields: Record<string, unknown>[] = [];

    const stopped = await runDeregisterAccountPushChannels(
      "account-1",
      makeDependencies(probe.registrar, observedFields) as never,
    );

    expect(stopped).toBe(CHANNEL_COUNT);
    expect(observedFields).toContainEqual(expect.objectContaining({
      "push_channel.disconnect_deregistered_count": CHANNEL_COUNT,
    }));
    expect(probe.peak).toBe(1);
  });

  it("still overlaps provider stops on the deadline-bound user teardown", async () => {
    const probe = makeOverlapProbe();
    const observedFields: Record<string, unknown>[] = [];

    const stopped = await runDeregisterUserPushChannels(
      "user-1",
      makeDependencies(probe.registrar, observedFields) as never,
    );

    expect(stopped).toBe(CHANNEL_COUNT);
    expect(observedFields).toContainEqual(expect.objectContaining({
      "push_channel.disconnect_deregistered_count": CHANNEL_COUNT,
    }));
    expect(probe.peak).toBeGreaterThan(1);
  });
});
