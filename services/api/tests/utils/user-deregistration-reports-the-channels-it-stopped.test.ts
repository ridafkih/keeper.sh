import { describe, expect, it, vi } from "vitest";
import { PUSH_CHANNEL_RESIDUE_KIND } from "@keeper.sh/calendar";
import type {
  TeardownResidueDraft,
  TeardownResidueRecord,
} from "@keeper.sh/calendar";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

const logging = vi.hoisted(() => ({ setFields: vi.fn() }));

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => run(),
  destroy: () => Promise.resolve(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    set: () => null,
    setFields: logging.setFields,
  },
}));

const deregistration = vi.hoisted(() => ({
  deregisterUserPushChannels: vi.fn(),
  listUserTeardownPushChannels: vi.fn(),
}));

vi.mock("@/utils/push-notifications/deregister-account-channels", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deregisterUserPushChannels: deregistration.deregisterUserPushChannels,
  listUserTeardownPushChannels: deregistration.listUserTeardownPushChannels,
}));

const DELETED_USER = "A";
const STOPPED_PROVIDER_CHANNEL_ID = "google-stopped-1";
const SURVIVING_PROVIDER_CHANNEL_ID = "google-still-running-2";

const teardownChannels = (): TeardownPushChannel[] => [
  {
    credential: { accessToken: "token", expiresAt: null, refreshToken: null },
    provider: "google",
    providerChannelId: STOPPED_PROVIDER_CHANNEL_ID,
    providerResourceId: "resource-A-1",
    userId: DELETED_USER,
  },
  {
    credential: { accessToken: "token", expiresAt: null, refreshToken: null },
    provider: "google",
    providerChannelId: SURVIVING_PROVIDER_CHANNEL_ID,
    providerResourceId: "resource-A-2",
    userId: DELETED_USER,
  },
];

interface ResidueHarness {
  rows: () => TeardownResidueRecord[];
  store: {
    clear: (id: string) => Promise<number>;
    delete: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
    deleteForUser: (userId: string, kind: string) => Promise<number>;
    list: () => Promise<TeardownResidueRecord[]>;
    record: (draft: TeardownResidueDraft) => Promise<void>;
  };
}

const createResidueHarness = (): ResidueHarness => {
  const rows: TeardownResidueRecord[] = [];

  const keep = (survivors: TeardownResidueRecord[]): number => {
    const removed = rows.length - survivors.length;

    rows.splice(0, rows.length, ...survivors);

    return removed;
  };

  return {
    rows: () => [...rows],
    store: {
      clear: (id) => Promise.resolve(keep(rows.filter((row) => row.id !== id))),
      delete: (userId, kind, providerChannelId) =>
        Promise.resolve(
          keep(
            rows.filter(
              (row) =>
                !(row.userId === userId
                  && row.kind === kind
                  && row.providerChannelId === providerChannelId),
            ),
          ),
        ),
      deleteForUser: (userId, kind) =>
        Promise.resolve(
          keep(rows.filter((row) => !(row.userId === userId && row.kind === kind))),
        ),
      list: () => Promise.resolve([...rows]),
      record: (draft) => {
        rows.push({ ...draft, id: `residue-${rows.length + 1}` } as TeardownResidueRecord);

        return Promise.resolve();
      },
    },
  };
};

const createTombstoneRedis = () => {
  const tombstones = new Map<string, string>();

  return {
    del: (key: string) => Promise.resolve(Number(tombstones.delete(key))),
    exists: (key: string) => Promise.resolve(Number(tombstones.has(key))),
    set: (key: string, value: string) => {
      tombstones.set(key, value);

      return Promise.resolve("OK");
    },
  };
};

const createQueue = () => ({
  getJob: () => Promise.resolve({}),
  remove: () => Promise.resolve(0),
});

const pushChannelIds = (residue: ResidueHarness): string[] =>
  residue
    .rows()
    .filter((row) => row.kind === PUSH_CHANNEL_RESIDUE_KIND)
    .map((row) => row.providerChannelId as string)
    .toSorted();

describe("user deregistration reports the channels it stopped", () => {
  it("clears push channel residue only for the provider channel ids it names as stopped", async () => {
    logging.setFields.mockClear();

    const residue = createResidueHarness();
    const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    await createDeleteUserSyncTeardown({
      createQueue,
      deregisterPushChannels: () =>
        Promise.resolve({ stoppedProviderChannelIds: [STOPPED_PROVIDER_CHANNEL_ID] }),
      listCalendarIds: () => Promise.resolve([]),
      listOAuthGrantProviders: () => Promise.resolve([]),
      listPushChannels: () => Promise.resolve(teardownChannels()),
      redis: createTombstoneRedis(),
      residue: residue.store,
    } as never)(DELETED_USER);

    expect(pushChannelIds(residue)).toEqual([SURVIVING_PROVIDER_CHANNEL_ID]);
  });

  it("wires the production teardown to the user-scoped deregistration and listing", async () => {
    logging.setFields.mockClear();
    deregistration.deregisterUserPushChannels.mockClear();
    deregistration.listUserTeardownPushChannels.mockClear();
    deregistration.deregisterUserPushChannels.mockResolvedValue({
      stoppedProviderChannelIds: [],
    });
    deregistration.listUserTeardownPushChannels.mockResolvedValue([]);

    const residue = createResidueHarness();
    const emptyQuery = { from: () => ({ where: () => Promise.resolve([]) }) };
    const { createApiDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

    await createApiDeleteUserSyncTeardown({
      database: { select: () => emptyQuery, selectDistinct: () => emptyQuery },
      queue: createQueue(),
      redis: createTombstoneRedis(),
      residue: residue.store,
    } as never)(DELETED_USER);

    expect(deregistration.listUserTeardownPushChannels).toHaveBeenCalledWith(DELETED_USER);
    expect(deregistration.deregisterUserPushChannels).toHaveBeenCalledWith(
      DELETED_USER,
      expect.any(AbortSignal),
    );
  });
});
