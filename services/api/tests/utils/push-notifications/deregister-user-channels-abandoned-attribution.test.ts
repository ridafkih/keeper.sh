import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePushRegistrar } from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

const loggedErrors: LoggedError[] = [];
const loggedFields: Record<string, unknown>[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: (prefix: string, error: unknown) => {
      loggedErrors.push({ error, fields: { prefix } });
    },
    errorFields: (error: unknown, fields: Record<string, unknown>) => {
      loggedErrors.push({ error, fields });
    },
    set: (key: string, value: unknown) => {
      loggedFields.push({ [key]: value });
    },
    setFields: (fields: Record<string, unknown>) => {
      loggedFields.push(fields);
    },
  },
}));

const NOW = new Date("2026-08-25T06:15:33.956Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_HASH = "a".repeat(64);
const NO_CONTENT = 204;
const DISCONNECT_TIMEOUT_MS = 5000;
const PROVIDER_LATENCY_MS = 3000;
const DELETED_USER_ID = "A";
const SURVIVING_USER_ID = "B";
const DELETED_CHANNEL_COUNT = 20;
const SURVIVING_CHANNEL_COUNT = 4;
const DRAIN_MS = 6000;
const MISSING_CREDENTIALS_MESSAGE = "No OAuth credentials found for push channel account";

const pad = (index: number): string => String(index).padStart(2, "0");

const makeChannel = (userId: string, index: number): StoredPushChannel => ({
  accountId: `account-${userId}-${pad(index)}`,
  calendarId: `cal-${userId}-${pad(index)}`,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  failureCount: 0,
  id: `channel-${userId}-${pad(index)}`,
  lastFailureAt: null,
  lastNotificationAt: NOW,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: `google-channel-${userId}-${pad(index)}`,
  providerResourceId: `google-resource-${userId}-${pad(index)}`,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId,
  verifiedAt: NOW,
});

const DELETED_CHANNELS = Array.from(
  { length: DELETED_CHANNEL_COUNT },
  (_value, index) => makeChannel(DELETED_USER_ID, index + 1),
);

const SURVIVING_CHANNELS = Array.from(
  { length: SURVIVING_CHANNEL_COUNT },
  (_value, index) => makeChannel(SURVIVING_USER_ID, index + 1),
);

const ALL_CHANNELS = [...DELETED_CHANNELS, ...SURVIVING_CHANNELS];

const channelByProviderChannelId = new Map(
  ALL_CHANNELS.map((channel) => [String(channel.providerChannelId), channel] as const),
);

interface ActivityEntry {
  at: number;
  ids: string[];
  kind: "context" | "dial" | "restate";
}

const activity: ActivityEntry[] = [];

let startedAt = 0;
let userRowGone = false;

const since = (): number => Date.now() - startedAt;

const record = (kind: ActivityEntry["kind"], ids: string[]): void => {
  activity.push({ at: since(), ids, kind });
};

const readStopBody = (init?: RequestInit): { id: string } => {
  if (typeof init?.body !== "string") {
    throw new TypeError("Provider stop request carried no JSON body");
  }
  return JSON.parse(init.body) as { id: string };
};

const sleepThenNoContent = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response(null, { status: NO_CONTENT }));
    }, PROVIDER_LATENCY_MS);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Provider stop request aborted", { cause: signal.reason }));
      },
      { once: true },
    );
  });

const stubFetch = ((_input: string | URL | Request, init?: RequestInit) => {
  const { id } = readStopBody(init);
  const channel = channelByProviderChannelId.get(id);

  if (!channel) {
    throw new Error(`Provider stop request named an unseeded channel ${id}`);
  }

  record("dial", [channel.id]);

  return sleepThenNoContent(init?.signal);
}) as typeof globalThis.fetch;

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = stubFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const createRegistrarContext = (channel: StoredPushChannel) => {
  record("context", [channel.id]);

  if (userRowGone) {
    return Promise.reject(
      new Error(`${MISSING_CREDENTIALS_MESSAGE} ${channel.accountId}`),
    );
  }

  return Promise.resolve({
    accessToken: "stub-token",
    channelId: channel.providerChannelId,
    fetchImpl: globalThis.fetch,
    notificationUrl: "https://keeper.example/api/webhook/google",
    now: NOW,
    requestedExpiresAt: NOW,
    signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
  });
};

const deregisterDependencies = {
  createRegistrarContext,
  listLiveChannels: (scopeId: string) =>
    Promise.resolve(ALL_CHANNELS.filter((channel) => channel.userId === scopeId)),
  markChannelsStopped: (channelIds: string[]) => {
    record("restate", [...channelIds]);
    return Promise.resolve();
  },
  observe: (fields: Record<string, unknown>) => {
    loggedFields.push(fields);
  },
  recordError: (error: unknown, slug: string) => {
    loggedErrors.push({ error, fields: { slug } });
  },
  resolveRegistrar: resolvePushRegistrar,
  webhookConfigured: true,
};

const deregisterPushChannels = (...args: unknown[]): Promise<number> =>
  (runDeregisterPushChannels as unknown as (...forwarded: unknown[]) => Promise<number>)(
    args[0],
    deregisterDependencies,
    ...args.slice(1),
  );

const teardownDependencies = {
  createQueue: () => ({
    getJob: () => Promise.resolve({}),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels,
  listCalendarIds: () => Promise.resolve([]),
  markChannelsStopped: deregisterDependencies.markChannelsStopped,
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(0),
    set: () => Promise.resolve("OK"),
  },
};

const wait = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const entriesOfKind = (kind: ActivityEntry["kind"]): ActivityEntry[] =>
  activity.filter((entry) => entry.kind === kind);

const idsOfKind = (kind: ActivityEntry["kind"]): string[] =>
  entriesOfKind(kind).flatMap((entry) => entry.ids);

const abandonedText = (): string => {
  const entries = loggedFields.flatMap((fields) =>
    Object.entries(fields).filter(([key]) => key.toLowerCase().includes("abandon")));
  return JSON.stringify(entries);
};

interface TeardownRun {
  resolvedAt: number;
  thrown: unknown;
}

const runTeardown = async (): Promise<TeardownRun> => {
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
  const teardown = createDeleteUserSyncTeardown(teardownDependencies as never);

  startedAt = Date.now();

  let thrown: unknown = null;
  try {
    await teardown(DELETED_USER_ID);
  } catch (error) {
    thrown = error;
  }

  const resolvedAt = since();
  userRowGone = true;

  await wait(DRAIN_MS);

  return { resolvedAt, thrown };
};

beforeEach(() => {
  activity.length = 0;
  loggedErrors.length = 0;
  loggedFields.length = 0;
  userRowGone = false;
});

describe("push channel teardown leaves no unnamed orphan", () => {
  it("names every channel it could not stop and issues nothing after it returns", async () => {
    const { resolvedAt, thrown } = await runTeardown();

    expect(thrown).toBeNull();

    const lateEntries = activity.filter((entry) => entry.at > resolvedAt);

    expect(lateEntries).toEqual([]);

    const restatedIds = idsOfKind("restate");
    const namedIds = DELETED_CHANNELS
      .filter((channel) => abandonedText().includes(channel.id))
      .map((channel) => channel.id);

    expect([...new Set([...restatedIds, ...namedIds])].toSorted()).toEqual(
      DELETED_CHANNELS.map((channel) => channel.id).toSorted(),
    );

    for (const channel of DELETED_CHANNELS.filter((row) => namedIds.includes(row.id))) {
      expect(abandonedText()).toContain(String(channel.providerChannelId));
      expect(abandonedText()).toContain(channel.provider);
    }

    const credentialErrors = loggedErrors.filter((entry) =>
      String((entry.error as Error).message).includes(MISSING_CREDENTIALS_MESSAGE));

    expect(credentialErrors).toEqual([]);

    const survivingIds = new Set(SURVIVING_CHANNELS.map((channel) => channel.id));

    expect(idsOfKind("dial").filter((id) => survivingIds.has(id))).toEqual([]);
    expect(idsOfKind("context").filter((id) => survivingIds.has(id))).toEqual([]);
    expect(restatedIds.filter((id) => survivingIds.has(id))).toEqual([]);
    for (const channel of SURVIVING_CHANNELS) {
      expect(abandonedText()).not.toContain(channel.id);
      expect(abandonedText()).not.toContain(String(channel.providerChannelId));
    }
  });
});
