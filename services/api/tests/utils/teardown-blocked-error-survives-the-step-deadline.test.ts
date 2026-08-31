import { describe, expect, it, vi } from "vitest";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

const DELETED_USER = "A";
const BLOCKING_ERROR_NAME = "TeardownBlockedError";
const INSIDE_THE_DEADLINE_MS = 10;
const JUST_PAST_THE_DEADLINE_MS = 100;

vi.mock("@/context", () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
  env: { REDIS_URL: "redis://localhost:6379" },
  redis: { set: () => Promise.resolve("OK") },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: null,
}));

const loadTeardown = async () => {
  vi.resetModules();
  vi.doMock("@/utils/logging", () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    widelog: {
      error: () => undefined,
      errorFields: () => undefined,
      set: () => undefined,
      setFields: () => undefined,
    },
  }));

  return await import("@/utils/delete-user-teardown");
};

const rejectAfter = (delayMs: number) => (): Promise<TeardownPushChannel[]> =>
  new Promise<TeardownPushChannel[]>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error("read ECONNRESET reading calendar_push_channels"));
    }, delayMs);
  });

const makeDependencies = (
  listPushChannels: () => Promise<TeardownPushChannel[]>,
) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: () => Promise.resolve(0),
  fetchImpl: () => Promise.reject(new Error("no grant is revoked by this suite")),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthGrantProviders: () => Promise.resolve([]),
  listPushChannels,
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: {
    clear: () => Promise.resolve(),
    deleteForUser: () => Promise.resolve(0),
    list: () => Promise.resolve([]),
    purgeOrphaned: () => Promise.resolve([]),
    record: () => Promise.resolve(),
  },
});

const rejectionOf = async (work: Promise<void>): Promise<unknown> =>
  await work.then(
    () => {
      throw new Error(
        "teardown resolved, so the delete would commit with the live push channels never captured",
      );
    },
    (error: unknown) => error,
  );

describe("a push channel capture failure that lands past the step deadline", () => {
  it("blocks the delete when the channel read fails well inside the deadline", async () => {
    const { createDeleteUserSyncTeardown } = await loadTeardown();
    const teardown = createDeleteUserSyncTeardown(
      makeDependencies(rejectAfter(INSIDE_THE_DEADLINE_MS)) as never,
    );

    const rejection = await rejectionOf(teardown(DELETED_USER));

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
  });

  it("blocks the delete when the channel read fails just past the deadline", async () => {
    const { createDeleteUserSyncTeardown, PUSH_CHANNELS_TIMEOUT_MS } = await loadTeardown();
    const teardown = createDeleteUserSyncTeardown(
      makeDependencies(
        rejectAfter(PUSH_CHANNELS_TIMEOUT_MS + JUST_PAST_THE_DEADLINE_MS),
      ) as never,
    );

    const rejection = await rejectionOf(teardown(DELETED_USER));

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
  });
});
