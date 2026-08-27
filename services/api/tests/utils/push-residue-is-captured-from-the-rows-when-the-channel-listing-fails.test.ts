import { describe, expect, it, vi } from "vitest";
import { runDeregisterPushChannels } from "@/utils/push-notifications/deregister-account-channels";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "@keeper.sh/calendar";

vi.mock("widelogger", () => ({
  widelog: {
    error: () => undefined,
    errorFields: () => undefined,
    errors: () => undefined,
    flush: () => undefined,
    set: () => undefined,
    setFields: () => undefined,
  },
  widelogger: () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
  }),
}));

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_TTL_MS = 60_000;
const SECRET_HASH = "a".repeat(64);
const DELETED_USER = "user-1";
const LISTING_ATTEMPTS = 3;

interface TeardownResidueRecord {
  credential?: {
    accessToken: string;
    expiresAt: Date | null;
    refreshToken: string | null;
  };
  externalId?: string;
  id: string;
  kind: string;
  provider?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

interface ResidueHarness {
  recorded: Omit<TeardownResidueRecord, "id">[];
  rows: () => TeardownResidueRecord[];
  store: {
    clear: (residueId: string) => Promise<void>;
    deleteForUser: (userId: string, kind: string) => Promise<number>;
    list: () => Promise<TeardownResidueRecord[]>;
    purgeOrphaned: () => Promise<string[]>;
    record: (draft: Omit<TeardownResidueRecord, "id">) => Promise<void>;
  };
}

const makeResidueHarness = (events: string[]): ResidueHarness => {
  const rows = new Map<string, TeardownResidueRecord>();
  const recorded: Omit<TeardownResidueRecord, "id">[] = [];

  return {
    recorded,
    rows: () => [...rows.values()],
    store: {
      clear: (residueId: string) => {
        rows.delete(residueId);
        return Promise.resolve();
      },
      deleteForUser: (userId: string, kind: string) => {
        const doomed = [...rows.entries()].filter(([, row]) =>
          row.userId === userId && row.kind === kind);

        for (const [id] of doomed) {
          rows.delete(id);
        }

        return Promise.resolve(doomed.length);
      },
      list: () => Promise.resolve([...rows.values()]),
      purgeOrphaned: () => Promise.resolve([]),
      record: (draft) => {
        const id = `residue-${rows.size + 1}`;
        events.push(`residue-record:${String(draft.providerChannelId ?? draft.kind)}`);
        recorded.push(draft);
        rows.set(id, { ...draft, id });
        return Promise.resolve();
      },
    },
  };
};

const liveChannel = (): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + CHANNEL_TTL_MS),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-user-1-1",
  providerResourceId: "resource-user-1-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: DELETED_USER,
  verifiedAt: NOW,
});

const makeRegistrar = (
  deregister: (channel: StoredPushChannel) => Promise<void>,
): SourcePushRegistrar => ({
  deregister,
  list: () => Promise.resolve([]),
  maxLifetimeMs: CHANNEL_TTL_MS,
  provider: "google",
  register: () => Promise.reject(new Error("register is not exercised by this suite")),
  renew: () => Promise.reject(new Error("renew is not exercised by this suite")),
  renewalMode: "recreate",
  resolveAffectedCalendarIds: () => Promise.resolve([]),
  scopeKind: "calendar",
  supportsList: true,
});

const registrarContextFor = (channel: StoredPushChannel): RegistrarContext => ({
  accessToken: `access-token-for-${channel.accountId}`,
  channelId: channel.providerChannelId,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.example/api/webhook/google",
  now: NOW,
  requestedExpiresAt: NOW,
});

const makeDeregisterPushChannels = (
  events: string[],
  listLiveChannels: (scopeId: string) => Promise<StoredPushChannel[]>,
  registrar: SourcePushRegistrar,
) =>
(userId: string, signal: AbortSignal): Promise<number> =>
  runDeregisterPushChannels(
    userId,
    {
      createRegistrarContext: (channel) => Promise.resolve(registrarContextFor(channel)),
      listLiveChannels: (scopeId) => {
        events.push("list-live-channels");
        return listLiveChannels(scopeId);
      },
      markChannelsStopped: () => Promise.resolve(),
      observe: () => undefined,
      recordError: () => undefined,
      resolveRegistrar: () => registrar,
      webhookConfigured: true,
    },
    signal,
    1,
    true,
  );

const makeSyncDependencies = (
  residue: ResidueHarness,
  deregisterPushChannels: (userId: string, signal: AbortSignal) => Promise<number>,
  channels: StoredPushChannel[],
) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels,
  fetchImpl: () => Promise.reject(new Error("no grant is revoked by this suite")),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: () => Promise.resolve([]),
  listPushChannels: (userId: string) =>
    Promise.resolve(channels.filter((channel) => channel.userId === userId)),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: residue.store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

describe("push residue captured from the channel rows", () => {
  it("records a stop-me row for every live channel before the listing that fails is even attempted", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const residue = makeResidueHarness(events);
    const channel = liveChannel();
    const registrar = makeRegistrar(() => {
      events.push("deregister");
      return Promise.resolve();
    });
    let listAttempts = 0;

    const deregisterPushChannels = makeDeregisterPushChannels(
      events,
      () => {
        listAttempts += 1;
        return Promise.reject(
          new Error("read ECONNRESET reading calendar_push_channels"),
        );
      },
      registrar,
    );

    await expect(
      createDeleteUserSyncTeardown(
        makeSyncDependencies(residue, deregisterPushChannels, [channel]) as never,
      )(DELETED_USER),
    ).resolves.toBeUndefined();

    expect(listAttempts).toBe(LISTING_ATTEMPTS);
    expect(events).not.toContain("deregister");

    expect(residue.recorded).toHaveLength(1);
    expect(residue.recorded[0]).toMatchObject({
      kind: "push_channel",
      provider: "google",
      providerChannelId: "google-user-1-1",
      providerResourceId: "resource-user-1-1",
      userId: DELETED_USER,
    });

    const recordIndex = events.indexOf("residue-record:google-user-1-1");
    const firstListIndex = events.indexOf("list-live-channels");

    expect(recordIndex).toBeGreaterThanOrEqual(0);
    expect(firstListIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeLessThan(firstListIndex);

    expect(residue.rows()).toHaveLength(1);
  });

  it("leaves no leftover work behind when every channel is stopped normally", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const residue = makeResidueHarness(events);
    const channel = liveChannel();
    const registrar = makeRegistrar(() => {
      events.push("deregister");
      return Promise.resolve();
    });

    const deregisterPushChannels = makeDeregisterPushChannels(
      events,
      (scopeId) =>
        Promise.resolve(scopeId === DELETED_USER ? [channel] : []),
      registrar,
    );

    await expect(
      createDeleteUserSyncTeardown(
        makeSyncDependencies(residue, deregisterPushChannels, [channel]) as never,
      )(DELETED_USER),
    ).resolves.toBeUndefined();

    const recordIndex = events.indexOf("residue-record:google-user-1-1");
    const deregisterIndex = events.indexOf("deregister");

    expect(recordIndex).toBeGreaterThanOrEqual(0);
    expect(deregisterIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeLessThan(deregisterIndex);

    expect(residue.rows()).toEqual([]);
  });
});
