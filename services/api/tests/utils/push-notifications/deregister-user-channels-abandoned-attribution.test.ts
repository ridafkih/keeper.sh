import { describe, expect, it, vi } from "vitest";
import { resolvePushRegistrar } from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: vi.fn(),
    errorFields: vi.fn(),
    set: vi.fn(),
    setFields: vi.fn(),
  },
}));

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

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

const makeChannels = (userId: string, count: number): StoredPushChannel[] =>
  Array.from({ length: count }, (_value, index) => makeChannel(userId, index + 1));

interface ActivityEntry {
  at: number;
  ids: string[];
  kind: "context" | "dial" | "restate";
}

type RecordActivity = (kind: ActivityEntry["kind"], ids: string[]) => void;

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

const makeStubFetch = (
  channelByProviderChannelId: Map<string, StoredPushChannel>,
  record: RecordActivity,
): typeof globalThis.fetch =>
  ((_input: string | URL | Request, init?: RequestInit) => {
    const { id } = readStopBody(init);
    const channel = channelByProviderChannelId.get(id);

    if (!channel) {
      throw new Error(`Provider stop request named an unseeded channel ${id}`);
    }

    record("dial", [channel.id]);

    return sleepThenNoContent(init?.signal);
  }) as typeof globalThis.fetch;

const wait = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const drainWideEventErrors = async (): Promise<LoggedError[]> => {
  const { widelog } = await import("@/utils/logging");
  const prefixed = vi.mocked(widelog.error).mock.calls.map(([prefix, error]) => ({
    error,
    fields: { prefix },
  }));
  const detailed = vi.mocked(widelog.errorFields).mock.calls.map(([error, fields]) => ({
    error,
    fields: { ...fields },
  }));

  return [...prefixed, ...detailed];
};

const drainWideEventFields = async (): Promise<Record<string, unknown>[]> => {
  const { widelog } = await import("@/utils/logging");
  const singles = vi.mocked(widelog.set).mock.calls.map(([key, value]) => ({ [key]: value }));
  const grouped = vi.mocked(widelog.setFields).mock.calls.map(([fields]) => fields);

  return [...singles, ...grouped];
};

const clearWideEvent = async (): Promise<void> => {
  const { widelog } = await import("@/utils/logging");

  for (const method of [widelog.error, widelog.errorFields, widelog.set, widelog.setFields]) {
    vi.mocked(method).mockClear();
  }
};

interface TeardownRun {
  activity: ActivityEntry[];
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
  resolvedAt: number;
  thrown: unknown;
}

const runTeardown = async (channels: StoredPushChannel[]): Promise<TeardownRun> => {
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  await clearWideEvent();

  const activity: ActivityEntry[] = [];
  const recordedErrors: LoggedError[] = [];
  const observedFields: Record<string, unknown>[] = [];
  const credentials = { userRowGone: false };
  const startedAt = Date.now();

  const since = (): number => Date.now() - startedAt;

  const record: RecordActivity = (kind, ids) => {
    activity.push({ at: since(), ids, kind });
  };

  const channelByProviderChannelId = new Map(
    channels.map((channel) => [String(channel.providerChannelId), channel] as const),
  );

  const markChannelsStopped = (channelIds: string[]): Promise<void> => {
    record("restate", [...channelIds]);
    return Promise.resolve();
  };

  const deregisterDependencies = {
    createRegistrarContext: (channel: StoredPushChannel) => {
      record("context", [channel.id]);

      if (credentials.userRowGone) {
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
    },
    listLiveChannels: (scopeId: string) =>
      Promise.resolve(channels.filter((channel) => channel.userId === scopeId)),
    markChannelsStopped,
    observe: (fields: Record<string, unknown>) => {
      observedFields.push(fields);
    },
    recordError: (error: unknown, slug: string) => {
      recordedErrors.push({ error, fields: { slug } });
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

  const teardown = createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels,
    listCalendarIds: () => Promise.resolve([]),
    listOAuthGrantProviders: () => Promise.resolve([]),
    markChannelsStopped,
    listPushChannels: () => Promise.resolve([]),
    redis: {
      del: () => Promise.resolve(1),
      exists: () => Promise.resolve(0),
      set: () => Promise.resolve("OK"),
    },
  } as never);

  const realFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(channelByProviderChannelId, record);

  let thrown: unknown = null;
  let resolvedAt = 0;
  try {
    try {
      await teardown(DELETED_USER_ID);
    } catch (error) {
      thrown = error;
    }

    resolvedAt = since();
    credentials.userRowGone = true;

    await wait(DRAIN_MS);
  } finally {
    globalThis.fetch = realFetch;
  }

  return {
    activity,
    loggedErrors: [...recordedErrors, ...await drainWideEventErrors()],
    loggedFields: [...observedFields, ...await drainWideEventFields()],
    resolvedAt,
    thrown,
  };
};

const idsOfKind = (run: TeardownRun, kind: ActivityEntry["kind"]): string[] =>
  run.activity.filter((entry) => entry.kind === kind).flatMap((entry) => entry.ids);

const abandonedText = (run: TeardownRun): string => {
  const entries = run.loggedFields.flatMap((fields) =>
    Object.entries(fields).filter(([key]) => key.toLowerCase().includes("abandon")));
  return JSON.stringify(entries);
};

describe("push channel teardown leaves no unnamed orphan", () => {
  it("names every channel it could not stop and issues nothing after it returns", async () => {
    const deletedChannels = makeChannels(DELETED_USER_ID, DELETED_CHANNEL_COUNT);
    const survivingChannels = makeChannels(SURVIVING_USER_ID, SURVIVING_CHANNEL_COUNT);
    const run = await runTeardown([...deletedChannels, ...survivingChannels]);

    expect(run.thrown).toBeNull();

    const lateEntries = run.activity.filter((entry) => entry.at > run.resolvedAt);

    expect(lateEntries).toEqual([]);

    const restatedIds = idsOfKind(run, "restate");
    const namedIds = deletedChannels
      .filter((channel) => abandonedText(run).includes(channel.id))
      .map((channel) => channel.id);

    expect([...new Set([...restatedIds, ...namedIds])].toSorted()).toEqual(
      deletedChannels.map((channel) => channel.id).toSorted(),
    );

    for (const channel of deletedChannels.filter((row) => namedIds.includes(row.id))) {
      expect(abandonedText(run)).toContain(String(channel.providerChannelId));
      expect(abandonedText(run)).toContain(channel.provider);
    }

    const credentialErrors = run.loggedErrors.filter((entry) =>
      String((entry.error as Error).message).includes(MISSING_CREDENTIALS_MESSAGE));

    expect(credentialErrors).toEqual([]);

    const survivingIds = new Set(survivingChannels.map((channel) => channel.id));

    expect(idsOfKind(run, "dial").filter((id) => survivingIds.has(id))).toEqual([]);
    expect(idsOfKind(run, "context").filter((id) => survivingIds.has(id))).toEqual([]);
    expect(restatedIds.filter((id) => survivingIds.has(id))).toEqual([]);
    for (const channel of survivingChannels) {
      expect(abandonedText(run)).not.toContain(channel.id);
      expect(abandonedText(run)).not.toContain(String(channel.providerChannelId));
    }
  });
});
