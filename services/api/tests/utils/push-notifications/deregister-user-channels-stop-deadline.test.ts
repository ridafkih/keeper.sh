import { describe, expect, it } from "vitest";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "@keeper.sh/calendar";
import { runDeregisterUserPushChannels } from "../../../src/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const PER_CHANNEL_TIMEOUT_MS = 50;
const SLOW_CONTEXT_BUILD_MS = 200;

const makeChannel = (index: number): StoredPushChannel => ({
  accountId: `account-${index}`,
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

interface TeardownRun {
  attempted: string[];
  observed: Record<string, unknown>[];
  recordedErrors: { error: unknown; slug: string }[];
  restated: string[];
  stopped: number;
}

const runTeardown = async (
  channelCount: number,
  slowChannelIndex: number,
): Promise<TeardownRun> => {
  const attempted: string[] = [];
  const observed: Record<string, unknown>[] = [];
  const recordedErrors: { error: unknown; slug: string }[] = [];
  const restated: string[] = [];

  const registrar: SourcePushRegistrar = {
    deregister: (channel: StoredPushChannel, context: RegistrarContext) => {
      attempted.push(String(context.channelId ?? channel.providerChannelId));
      if (!context.accessToken) {
        throw new Error(`Missing access token for channel ${channel.id}`);
      }
      if (context.signal?.aborted) {
        throw new Error(`Stop for channel ${channel.id} aborted before reaching Google`);
      }
      return Promise.resolve();
    },
  } as unknown as SourcePushRegistrar;

  const channels = Array.from(
    { length: channelCount },
    (_value, index) => makeChannel(index),
  );

  const stopped = await runDeregisterUserPushChannels("user-1", {
    createRegistrarContext: async (channel: StoredPushChannel) => {
      if (channel.id === `channel-${slowChannelIndex}`) {
        await Bun.sleep(SLOW_CONTEXT_BUILD_MS);
      }
      return {
        accessToken: `token-${channel.id}`,
        channelId: channel.providerChannelId,
        fetchImpl: globalThis.fetch,
        notificationUrl: "https://example.com/api/webhook/google",
        now: NOW,
        requestedExpiresAt: NOW,
        signal: AbortSignal.timeout(PER_CHANNEL_TIMEOUT_MS),
      } as RegistrarContext;
    },
    listLiveChannels: () => Promise.resolve(channels),
    markChannelsStopped: (channelIds: string[]) => {
      restated.push(...channelIds);
      return Promise.resolve();
    },
    observe: (fields: Record<string, unknown>) => {
      observed.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      recordedErrors.push({ error, slug });
    },
    resolveRegistrar: () => registrar,
    webhookConfigured: true,
  }, null);

  return { attempted, observed, recordedErrors, restated, stopped };
};

describe("push channel stop deadline starts at its own attempt", () => {
  it("still attempts both channels when one context build outlasts the per-channel timeout", async () => {
    const run = await runTeardown(2, 1);

    expect(run.attempted.toSorted()).toEqual(["google-channel-0", "google-channel-1"]);
    expect(run.stopped).toBe(2);
    expect(run.recordedErrors).toEqual([]);
    expect(run.observed).toContainEqual(expect.objectContaining({
      "push_channel.disconnect_abandoned_count": 0,
      "push_channel.disconnect_deregistered_count": 2,
    }));
  });

  it("asks the provider to stop every channel when one credential refresh is slow", async () => {
    const channelCount = 6;
    const run = await runTeardown(channelCount, 3);

    expect(run.attempted).toHaveLength(channelCount);
    expect(run.attempted.toSorted()).toEqual(
      Array.from({ length: channelCount }, (_value, index) => `google-channel-${index}`)
        .toSorted(),
    );
    expect(run.stopped).toBe(channelCount);
    expect(run.restated).toHaveLength(channelCount);
    expect(run.recordedErrors).toEqual([]);
    expect(run.observed).toContainEqual(expect.objectContaining({
      "push_channel.disconnect_abandoned": [],
      "push_channel.disconnect_abandoned_count": 0,
      "push_channel.disconnect_abandoned_reason": [],
      "push_channel.disconnect_deregistered_count": channelCount,
    }));
  });
});
