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

const DELETED_USER = "A";
const FIRST_PROVIDER_CHANNEL_ID = "google-live-1";
const SECOND_PROVIDER_CHANNEL_ID = "google-live-2";

const teardownChannels = (): TeardownPushChannel[] => [
  {
    credential: { accessToken: "token", expiresAt: null, refreshToken: null },
    provider: "google",
    providerChannelId: FIRST_PROVIDER_CHANNEL_ID,
    providerResourceId: "resource-A-1",
    userId: DELETED_USER,
  },
  {
    credential: { accessToken: "token", expiresAt: null, refreshToken: null },
    provider: "google",
    providerChannelId: SECOND_PROVIDER_CHANNEL_ID,
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

const runTeardown = async (
  residue: ResidueHarness["store"],
  stoppedProviderChannelIds: string[],
): Promise<void> => {
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  const tombstones = new Map<string, string>();

  await createDeleteUserSyncTeardown({
    createQueue: () => ({
      getJob: () => Promise.resolve({}),
      remove: () => Promise.resolve(0),
    }),
    deregisterPushChannels: () => Promise.resolve({ stoppedProviderChannelIds }),
    listCalendarIds: () => Promise.resolve([]),
    listOAuthGrantProviders: () => Promise.resolve([]),
    listPushChannels: () => Promise.resolve(teardownChannels()),
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

const pushChannelIds = (residue: ResidueHarness): string[] =>
  residue
    .rows()
    .filter((row) => row.kind === PUSH_CHANNEL_RESIDUE_KIND)
    .map((row) => row.providerChannelId as string)
    .toSorted();

describe("push channel residue and a deregistration that stopped nothing", () => {
  it("survives a reported count that accounts for no captured channel", async () => {
    logging.setFields.mockClear();

    const residue = createResidueHarness();

    await runTeardown(residue.store, []);

    expect(pushChannelIds(residue)).toEqual([
      FIRST_PROVIDER_CHANNEL_ID,
      SECOND_PROVIDER_CHANNEL_ID,
    ]);
    expect(logging.setFields).toHaveBeenCalledWith(
      expect.objectContaining({ "delete_user.push_channels_unaccounted": 2 }),
    );
  });

  it("is cleared when the reported count accounts for every captured channel", async () => {
    logging.setFields.mockClear();

    const residue = createResidueHarness();

    await runTeardown(residue.store, [
      FIRST_PROVIDER_CHANNEL_ID,
      SECOND_PROVIDER_CHANNEL_ID,
    ]);

    expect(pushChannelIds(residue)).toEqual([]);
  });
});
