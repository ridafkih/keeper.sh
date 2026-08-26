import { describe, expect, it, vi } from "vitest";
import type { DeleteUserSyncQueue } from "@/utils/delete-user-teardown";

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

const { createUserDeletedCheck, deletedUserTombstoneKey } = await import("@keeper.sh/calendar");
const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } = await import(
  "@/utils/delete-user-teardown"
);

const SLOW_FIRST_SET_MS = 2500;
const RETRY_DRAIN_MS = 1000;
const USER_ID = "user-1";
const NO_QUEUE_COMMAND_EXPECTED = "no queue command is expected for a user with no calendars";

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const createFifoRedis = () => {
  const store = new Map<string, string>();
  const setKeys: string[] = [];

  return {
    del: (key: string) => Promise.resolve(Number(store.delete(key))),
    exists: (key: string) => Promise.resolve(Number(store.has(key))),
    set: (key: string, value: string, _mode: "EX", _ttlSeconds: number) => {
      store.set(key, value);
      setKeys.push(key);

      if (setKeys.length > 1) {
        return Promise.resolve("OK");
      }

      return new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("Command timed out"));
        }, SLOW_FIRST_SET_MS);
      });
    },
    setKeys,
    store,
  };
};

const createUnusedQueue = (): DeleteUserSyncQueue => ({
  getJob: () => Promise.reject(new Error(NO_QUEUE_COMMAND_EXPECTED)),
  remove: () => Promise.reject(new Error(NO_QUEUE_COMMAND_EXPECTED)),
});

describe("delete user teardown tombstone abort", () => {
  it("leaves no tombstone behind when the aborted write retries after the rollback", async () => {
    const redis = createFifoRedis();

    const teardown = createDeleteUserSyncTeardown({
      createQueue: createUnusedQueue,
      deregisterPushChannels: () => Promise.resolve(0),
      listCalendarIds: () => Promise.resolve([]),
      redis,
    });

    await teardown(USER_ID);

    await createDeleteUserSyncTeardownRollback({ redis })(USER_ID);

    expect([...redis.store.keys()]).toEqual([]);

    const setsAfterRollback = redis.setKeys.length;

    await sleep(SLOW_FIRST_SET_MS + RETRY_DRAIN_MS);

    expect([...redis.store.keys()]).toEqual([]);
    expect(redis.store.has(deletedUserTombstoneKey(USER_ID))).toBe(false);
    expect(redis.setKeys.length).toBe(setsAfterRollback);

    const isDeleted = createUserDeletedCheck(redis, USER_ID, {
      isUserRowPresent: () => Promise.resolve(true),
    });

    await expect(isDeleted()).resolves.toBe(false);
  });
});
