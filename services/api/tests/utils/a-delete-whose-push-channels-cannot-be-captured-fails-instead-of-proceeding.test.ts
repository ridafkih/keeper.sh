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

const makeResidueHarness = (
  record: (draft: ResidueDraft) => Promise<void>,
): ResidueHarness => {
  const recorded: ResidueDraft[] = [];

  return {
    recorded,
    store: {
      clear: () => Promise.resolve(),
      deleteForUser: () => Promise.resolve(0),
      list: () => Promise.resolve([]),
      purgeOrphaned: () => Promise.resolve([]),
      record: async (draft) => {
        recorded.push(draft);
        await record(draft);
      },
    },
  };
};

const liveChannel = (): TeardownPushChannel => ({
  credential: null,
  provider: "google",
  providerChannelId: "google-user-1-1",
  providerResourceId: "resource-user-1-1",
  userId: DELETED_USER,
});

interface DependencyOverrides {
  deregisterPushChannels?: (userId: string, signal: AbortSignal) => Promise<number>;
  listPushChannels?: (userId: string) => Promise<TeardownPushChannel[]>;
  redisSet?: () => Promise<string>;
  residue?: ResidueHarness;
}

const makeDependencies = (overrides: DependencyOverrides) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: overrides.deregisterPushChannels ?? (() => Promise.resolve(1)),
  fetchImpl: () => Promise.reject(new Error("no grant is revoked by this suite")),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthGrantProviders: () => Promise.resolve([]),
  listPushChannels:
    overrides.listPushChannels ?? (() => Promise.resolve([liveChannel()])),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: overrides.redisSet ?? (() => Promise.resolve("OK")),
  },
  residue: (overrides.residue ?? makeResidueHarness(() => Promise.resolve())).store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

describe("a delete whose push channels cannot be captured", () => {
  it("rejects with a blocking error naming the user and the step when the channel rows cannot be read", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const residue = makeResidueHarness(() => Promise.resolve());

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        listPushChannels: () =>
          Promise.reject(new Error("read ECONNRESET reading calendar_push_channels")),
        residue,
      }) as never,
    );

    const rejection: unknown = await teardown(DELETED_USER).then(
      () => {
        throw new Error(
          "teardown resolved, so the user row would delete and cascade the uncaptured push channels away",
        );
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
    expect((rejection as Error).message).toContain(DELETED_USER);
    expect((rejection as Error).message).toContain(PUSH_CHANNELS_STEP);
    expect(residue.recorded).toEqual([]);
  });

  it("rejects with a blocking error when a live channel cannot be written to the residue store", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const residue = makeResidueHarness(() =>
      Promise.reject(new Error("write ECONNRESET writing teardown_residue")));

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({ residue }) as never,
    );

    const rejection: unknown = await teardown(DELETED_USER).then(
      () => {
        throw new Error(
          "teardown resolved, so an uncaptured live push channel would outlive the deleted user",
        );
      },
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
    expect((rejection as Error).message).toContain(DELETED_USER);
    expect((rejection as Error).message).toContain(PUSH_CHANNELS_STEP);
  });

  it("still resolves when the capture succeeds and only the deregistration fails", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const residue = makeResidueHarness(() => Promise.resolve());

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        deregisterPushChannels: () =>
          Promise.reject(new Error("read ECONNRESET deregistering google channels")),
        residue,
      }) as never,
    );

    await expect(teardown(DELETED_USER)).resolves.toBeUndefined();

    expect(residue.recorded).toHaveLength(1);
    expect(residue.recorded[0]).toMatchObject({
      kind: "push_channel",
      providerChannelId: "google-user-1-1",
      userId: DELETED_USER,
    });
  });

  it("still resolves when a redis blip fails the tombstone step", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const residue = makeResidueHarness(() => Promise.resolve());

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        redisSet: () => Promise.reject(new Error("READONLY You can't write against a replica")),
        residue,
      }) as never,
    );

    await expect(teardown(DELETED_USER)).resolves.toBeUndefined();
  });
});
