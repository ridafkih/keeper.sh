import { describe, expect, it, vi } from "vitest";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

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

const DELETED_USER = "user-1";
const PUSH_CHANNELS_STEP = "push_channels";
const BLOCKING_ERROR_NAME = "TeardownBlockedError";
const LIVE_CHANNEL_COUNT = 4;
const OVERRUNNING_LISTING_MS = 3000;

interface ResidueDraft {
  kind: string;
  providerChannelId?: string;
  userId: string;
}

interface ResidueHarness {
  recorded: ResidueDraft[];
  store: {
    clear: (residueId: string) => Promise<void>;
    deleteForUser: (userId: string, kind: string) => Promise<number>;
    list: () => Promise<ResidueDraft[]>;
    purgeOrphaned: () => Promise<string[]>;
    record: (draft: ResidueDraft) => Promise<void>;
  };
}

const makeResidueHarness = (): ResidueHarness => {
  const recorded: ResidueDraft[] = [];

  return {
    recorded,
    store: {
      clear: () => Promise.resolve(),
      deleteForUser: () => Promise.resolve(0),
      list: () => Promise.resolve([]),
      purgeOrphaned: () => Promise.resolve([]),
      record: (draft) => {
        recorded.push(draft);

        return Promise.resolve();
      },
    },
  };
};

const liveChannel = (index: number): TeardownPushChannel => ({
  credential: null,
  provider: "google",
  providerChannelId: `google-user-1-${index}`,
  providerResourceId: `resource-user-1-${index}`,
  userId: DELETED_USER,
});

const liveChannels = (): TeardownPushChannel[] =>
  Array.from({ length: LIVE_CHANNEL_COUNT }, (_unused, index) => liveChannel(index));

interface DependencyOverrides {
  deregisterPushChannels?: (userId: string, signal: AbortSignal) => Promise<number>;
  listPushChannels?: (userId: string) => Promise<TeardownPushChannel[]>;
  residue?: ResidueHarness;
}

const makeDependencies = (overrides: DependencyOverrides) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: overrides.deregisterPushChannels ?? (() => Promise.resolve(1)),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: () => Promise.resolve([]),
  listPushChannels: overrides.listPushChannels ?? (() => Promise.resolve(liveChannels())),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: (overrides.residue ?? makeResidueHarness()).store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

describe("a push channel listing that outruns its step deadline", () => {
  it("blocks the delete instead of committing it against an unread channel list", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();

    const residue = makeResidueHarness();

    let deregisterCalls = 0;

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        deregisterPushChannels: () => {
          deregisterCalls += 1;

          return Promise.resolve(LIVE_CHANNEL_COUNT);
        },
        listPushChannels: () =>
          new Promise<TeardownPushChannel[]>((resolve) => {
            setTimeout(() => {
              resolve(liveChannels());
            }, OVERRUNNING_LISTING_MS);
          }),
        residue,
      }) as never,
    );

    const rejection: unknown = await teardown(DELETED_USER).then(
      () => {
        throw new Error(
          "teardown resolved, so the user row would delete and cascade away push channels that "
            + "were never listed, leaving them to keep delivering unknown_channel webhooks until "
            + "they expire at the provider",
        );
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
    expect((rejection as Error).message).toContain(DELETED_USER);
    expect((rejection as Error).message).toContain(PUSH_CHANNELS_STEP);
    expect(deregisterCalls).toBe(0);
    expect(residue.recorded).toEqual([]);
  });
});
