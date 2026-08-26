import { describe, expect, it } from "vitest";
import { widelog, widelogger } from "widelogger";
import { resolvePushRegistrar } from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannelsOutcome } from "@/utils/push-notifications/deregister-account-channels";

const NOW = new Date("2026-08-25T06:15:33.956Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_HASH = "b".repeat(64);
const UNAUTHORIZED = 401;
const SERVICE_UNAVAILABLE = 503;
const USER_ID = "user-a";
const UNRELATED_ERROR_MESSAGE = "Account row could not be locked for deletion";

const makeChannel = (id: string, providerChannelId: string): StoredPushChannel => ({
  accountId: `account-${id}`,
  calendarId: `cal-${id}`,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  failureCount: 0,
  id,
  lastFailureAt: null,
  lastNotificationAt: NOW,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId,
  providerResourceId: `resource-${providerChannelId}`,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: USER_ID,
  verifiedAt: NOW,
});

const CHANNELS = [makeChannel("chan-1", "g-1"), makeChannel("chan-2", "g-2")];

const STATUS_BY_PROVIDER_CHANNEL_ID: Record<string, number> = {
  "g-1": UNAUTHORIZED,
  "g-2": SERVICE_UNAVAILABLE,
};

const BODY_BY_STATUS: Record<number, string> = {
  [UNAUTHORIZED]: JSON.stringify({ error: "invalid_grant" }),
  [SERVICE_UNAVAILABLE]: JSON.stringify({ error: "backendError" }),
};

const readStopBody = (init?: RequestInit): { id: string } => {
  if (typeof init?.body !== "string") {
    throw new TypeError("Provider stop request carried no JSON body");
  }
  return JSON.parse(init.body) as { id: string };
};

const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
  const { id } = readStopBody(init);
  const status = STATUS_BY_PROVIDER_CHANNEL_ID[id];
  if (status === undefined) {
    throw new Error(`Provider stop request named an unseeded channel ${id}`);
  }
  return Promise.resolve(new Response(BODY_BY_STATUS[status], { status }));
}) as typeof globalThis.fetch;

const { context } = widelogger({
  defaultEventName: "wide_event",
  environment: "production",
  service: "keeper-api",
});

const dependencies = {
  createRegistrarContext: (channel: StoredPushChannel) =>
    Promise.resolve({
      accessToken: "stub-token",
      channelId: channel.providerChannelId,
      fetchImpl,
      notificationUrl: "https://keeper.example/api/webhook/google",
      now: NOW,
      requestedExpiresAt: NOW,
    }),
  listLiveChannels: () => Promise.resolve(CHANNELS),
  markChannelsStopped: () => Promise.resolve(),
  observe: (fields: Record<string, unknown>) => {
    widelog.setFields(fields);
  },
  recordError: (error: unknown, slug: string) => {
    widelog.errorFields(error, { retriable: false, slug });
  },
  resolveRegistrar: resolvePushRegistrar,
  webhookConfigured: true,
};

const captureEmittedEvent = (emit: () => void): Record<string, unknown> => {
  const lines: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    emit();
  } finally {
    process.stdout.write = realWrite;
  }

  const emittedLines = lines.join("").trim().split("\n");
  const serialized = emittedLines.at(-1);
  if (!serialized) {
    throw new Error("No wide event reached the logger transport");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
};

describe("abandoned push channel reporting", () => {
  it("carries every abandoned channel's identity and reason into the flushed wide event", async () => {
    const outcome = await context(async () => {
      widelog.errorFields(new Error(UNRELATED_ERROR_MESSAGE), {
        retriable: false,
        slug: "account-lock-failed",
      });

      const result = await runDeregisterPushChannelsOutcome(USER_ID, dependencies);
      return { emittedEvent: captureEmittedEvent(() => widelog.flush()), result };
    });

    const { emittedEvent: event, result } = outcome;

    expect(result.abandonments).toHaveLength(2);

    const serialized = JSON.stringify(event);

    for (const identifier of ["chan-1", "chan-2", "g-1", "g-2"]) {
      expect(serialized).toContain(identifier);
    }

    for (const reason of [
      `Google channel stop failed with status ${UNAUTHORIZED}`,
      `Google channel stop failed with status ${SERVICE_UNAVAILABLE}`,
    ]) {
      expect(serialized).toContain(reason);
    }

    const errorSection = event.error as Record<string, unknown>;
    expect(errorSection.error_message).toBe(UNRELATED_ERROR_MESSAGE);
  });
});
