import { describe, expect, it, vi } from "vitest";
import { PUSH_CHANNEL_RESIDUE_KIND, resolvePushRegistrar } from "@keeper.sh/calendar";
import type {
  StoredPushChannel,
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import { runDeregisterPushChannelsOutcome } from "@/utils/push-notifications/deregister-account-channels";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

const NOW = new Date("2026-08-25T06:15:33.956Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_HASH = "a".repeat(64);
const NO_CONTENT = 204;
const DELETED_USER = "A";
const FIRST_PROVIDER_CHANNEL_ID = "google-stopped-1";
const SECOND_PROVIDER_CHANNEL_ID = "google-stopped-2";
const ROTATED_AWAY_PROVIDER_CHANNEL_ID = "google-live-from-earlier-attempt";

const makeChannel = (overrides: Partial<StoredPushChannel>): StoredPushChannel => ({
  accountId: "account-A",
  calendarId: "cal-A-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
  failureCount: 0,
  id: "channel-A-1",
  lastFailureAt: null,
  lastNotificationAt: NOW,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: FIRST_PROVIDER_CHANNEL_ID,
  providerResourceId: "resource-A-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: DELETED_USER,
  verifiedAt: NOW,
  ...overrides,
});

const seedChannels = (): StoredPushChannel[] => [
  makeChannel({}),
  makeChannel({
    accountId: "account-A-2",
    calendarId: "cal-A-2",
    id: "channel-A-2",
    providerChannelId: SECOND_PROVIDER_CHANNEL_ID,
    providerResourceId: "resource-A-2",
  }),
];

const teardownChannelOf = (channel: StoredPushChannel): TeardownPushChannel => ({
  credential: { accessToken: "token", expiresAt: null, refreshToken: null },
  provider: channel.provider,
  providerChannelId: channel.providerChannelId,
  providerResourceId: channel.providerResourceId,
  userId: channel.userId,
});

interface ResidueDelete {
  kind: string;
  providerChannelId: string;
  userId: string;
}

interface ResidueHarness {
  deleteCalls: () => ResidueDelete[];
  deleteForUserCalls: () => { kind: string; userId: string }[];
  rows: () => TeardownResidueRecord[];
  store: {
    delete: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
    deleteForUser: (userId: string, kind: string) => Promise<number>;
    record: (draft: TeardownResidueDraft) => Promise<void>;
  };
}

const createResidueHarness = (): ResidueHarness => {
  const rows: TeardownResidueRecord[] = [];
  const deleteCalls: ResidueDelete[] = [];
  const deleteForUserCalls: { kind: string; userId: string }[] = [];

  return {
    deleteCalls: () => [...deleteCalls],
    deleteForUserCalls: () => [...deleteForUserCalls],
    rows: () => [...rows],
    store: {
      delete: (userId, kind, providerChannelId) => {
        deleteCalls.push({ kind, providerChannelId, userId });

        const survivors = rows.filter(
          (row) =>
            !(row.userId === userId
              && row.kind === kind
              && row.providerChannelId === providerChannelId),
        );
        const removed = rows.length - survivors.length;

        rows.splice(0, rows.length, ...survivors);

        return Promise.resolve(removed);
      },
      deleteForUser: (userId, kind) => {
        deleteForUserCalls.push({ kind, userId });

        const survivors = rows.filter(
          (row) => !(row.userId === userId && row.kind === kind),
        );
        const removed = rows.length - survivors.length;

        rows.splice(0, rows.length, ...survivors);

        return Promise.resolve(removed);
      },
      record: (draft) => {
        rows.push({ ...draft, id: `residue-${rows.length + 1}` });

        return Promise.resolve();
      },
    },
  };
};

const stopRequests: string[] = [];

const readStoppedChannelId = (init?: RequestInit): string => {
  if (typeof init?.body !== "string") {
    throw new TypeError("Provider stop request carried no JSON body");
  }
  return (JSON.parse(init.body) as { id: string }).id;
};

const stubFetch = ((input: string | URL | Request, init?: RequestInit) => {
  stopRequests.push(readStoppedChannelId(init));

  return Promise.resolve(new Response(null, { status: NO_CONTENT }));
}) as typeof globalThis.fetch;

const deregisterUserChannels = async (
  channels: StoredPushChannel[],
  signal: AbortSignal | null,
): Promise<number> => {
  const outcome = await runDeregisterPushChannelsOutcome(
    DELETED_USER,
    {
      createRegistrarContext: (channel) =>
        Promise.resolve({
          accessToken: "token",
          channelId: channel.providerChannelId,
          fetchImpl: stubFetch,
          notificationUrl: "https://keeper.example/api/webhook/google",
          now: NOW,
          requestedExpiresAt: NOW,
        }),
      listLiveChannels: () => Promise.resolve(channels),
      markChannelsStopped: () => Promise.resolve(),
      observe: () => undefined,
      recordError: () => undefined,
      resolveRegistrar: resolvePushRegistrar,
      webhookConfigured: true,
    },
    signal,
    1,
    true,
    true,
  );

  if (outcome.abandonments.length > 0) {
    throw new AggregateError(
      outcome.abandonments,
      `${outcome.abandonments.length} push channel(s) for userId ${DELETED_USER} were left running at their provider`,
    );
  }

  return outcome.deregisteredCount;
};

const runTeardown = async (residue: ResidueHarness["store"]): Promise<void> => {
  const channels = seedChannels();
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  const tombstones = new Map<string, string>();

  await createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels: (_userId: string, signal: AbortSignal) =>
      deregisterUserChannels(channels, signal),
    listCalendarIds: () => Promise.resolve([]),
    listOAuthCredentials: () => Promise.resolve([]),
    listPushChannels: () =>
      Promise.resolve(channels.map((channel) => teardownChannelOf(channel))),
    redis: {
      del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
      exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
      set: (key: string, value: string) => {
        tombstones.set(key, value);
        return Promise.resolve("OK");
      },
    },
    residue,
  } as never)(DELETED_USER);
};

describe("push residue left by an earlier teardown attempt", () => {
  it("survives a teardown that stopped every channel it captured itself", async () => {
    stopRequests.length = 0;

    const residue = createResidueHarness();

    await residue.store.record({
      kind: PUSH_CHANNEL_RESIDUE_KIND,
      provider: "google",
      providerChannelId: ROTATED_AWAY_PROVIDER_CHANNEL_ID,
      providerResourceId: "resource-from-earlier-attempt",
      userId: DELETED_USER,
    });

    await runTeardown(residue.store);

    expect(stopRequests).toEqual([
      FIRST_PROVIDER_CHANNEL_ID,
      SECOND_PROVIDER_CHANNEL_ID,
    ]);
    expect(residue.deleteForUserCalls()).toEqual([]);

    const survivingChannelIds = residue
      .rows()
      .filter((row) => row.kind === PUSH_CHANNEL_RESIDUE_KIND)
      .map((row) => row.providerChannelId);

    expect(survivingChannelIds).toContain(ROTATED_AWAY_PROVIDER_CHANNEL_ID);
    expect(survivingChannelIds).not.toContain(FIRST_PROVIDER_CHANNEL_ID);
    expect(survivingChannelIds).not.toContain(SECOND_PROVIDER_CHANNEL_ID);
  });
});
