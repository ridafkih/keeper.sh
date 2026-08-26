import { describe, expect, it } from "vitest";
import { resolvePushRegistrar } from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterUserPushChannels } from "../../../src/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_COUNT = 6;
const DISCONNECT_TIMEOUT_MS = 5000;
const TEARDOWN_BUDGET_MS = 9000;

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

const seedChannels = (): StoredPushChannel[] =>
  Array.from({ length: CHANNEL_COUNT }, (_value, index) => makeChannel(index));

describe("push channel teardown concurrency for a deleted user", () => {
  it("attempts every channel inside the teardown budget when the provider never responds", async () => {
    let acceptedConnections = 0;
    let receivedChunks = 0;
    const blackHole = Bun.listen<undefined>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data: () => {
          receivedChunks += 1;
        },
        open: () => {
          acceptedConnections += 1;
        },
      },
    });
    const blackHoleUrl = `http://127.0.0.1:${blackHole.port}/stop`;

    const channels = seedChannels();
    const attempted: string[] = [];
    const observedFields: Record<string, unknown>[] = [];
    const recordedErrors: unknown[] = [];

    try {
      const startedAt = Date.now();
      const stopped = await runDeregisterUserPushChannels("user-1", {
        createRegistrarContext: (channel: StoredPushChannel) => Promise.resolve({
          accessToken: "token",
          channelId: channel.providerChannelId,
          fetchImpl: ((_url: string, init?: RequestInit) => {
            attempted.push(String(channel.providerChannelId));
            return fetch(blackHoleUrl, { method: "POST", signal: init?.signal });
          }) as unknown as typeof globalThis.fetch,
          notificationUrl: "https://example.com/api/webhook/google",
          now: NOW,
          requestedExpiresAt: NOW,
          signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
        }),
        listLiveChannels: () => Promise.resolve([...channels]),
        observe: (fields: Record<string, unknown>) => {
          observedFields.push(fields);
        },
        recordError: (error: unknown) => {
          recordedErrors.push(error);
        },
        resolveRegistrar: resolvePushRegistrar,
        webhookConfigured: true,
      } as never);
      const elapsedMs = Date.now() - startedAt;

      expect(attempted.toSorted()).toEqual(
        channels.map((channel) => String(channel.providerChannelId)).toSorted(),
      );
      expect(stopped).toBe(0);
      expect(recordedErrors).toHaveLength(CHANNEL_COUNT);
      expect(observedFields).toContainEqual(expect.objectContaining({
        "push_channel.disconnect_deregistered_count": 0,
        "push_channel.disconnect_live_count": CHANNEL_COUNT,
      }));
      expect(elapsedMs).toBeLessThan(TEARDOWN_BUDGET_MS);
      expect(acceptedConnections).toBeGreaterThan(0);
      expect(receivedChunks).toBeGreaterThan(0);
    } finally {
      blackHole.stop(true);
    }
  });
});
