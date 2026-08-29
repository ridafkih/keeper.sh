import { describe, expect, it, vi } from "vitest";
import type { DeleteUserSyncQueue } from "@/utils/delete-user-teardown";

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

const USER_ID = "user-1";
const BLOCKING_ERROR_NAME = "TeardownBlockedError";
const HUNG_SET_SETTLE_MS = 2500;
const TEST_TIMEOUT_MS = 60_000;
const NO_QUEUE_COMMAND_EXPECTED = "no queue command is expected for a user with no calendars";

const createUnusedQueue = (): DeleteUserSyncQueue => ({
  getJob: () => Promise.reject(new Error(NO_QUEUE_COMMAND_EXPECTED)),
  remove: () => Promise.reject(new Error(NO_QUEUE_COMMAND_EXPECTED)),
});

const createReadOnlyReplicaRedis = () => ({
  del: () => Promise.resolve(0),
  exists: () => Promise.resolve(0),
  set: () =>
    Promise.reject(new Error("READONLY You can't write against a read only replica.")),
});

const createHungFirstSetRedis = () => {
  const store = new Map<string, string>();
  const setKeys: string[] = [];

  return {
    del: (key: string) => Promise.resolve(Number(store.delete(key))),
    exists: (key: string) => Promise.resolve(Number(store.has(key))),
    set: (key: string, value: string, _mode: "EX", _ttlSeconds: number) => {
      setKeys.push(key);

      if (setKeys.length > 1) {
        store.set(key, value);

        return Promise.resolve("OK");
      }

      return new Promise<string>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("Command timed out"));
        }, HUNG_SET_SETTLE_MS);
      });
    },
  };
};

const runTeardownAgainst = async (
  redis: Pick<ReturnType<typeof createHungFirstSetRedis>, "del" | "exists" | "set">,
): Promise<{ listCalendarIdsCalls: number; rejection: unknown }> => {
  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");

  let listCalendarIdsCalls = 0;

  const teardown = createDeleteUserSyncTeardown({
    createQueue: createUnusedQueue,
    deregisterPushChannels: () => Promise.resolve({ stoppedProviderChannelIds: [] }),
    listCalendarIds: () => {
      listCalendarIdsCalls += 1;

      return Promise.resolve([]);
    },
    listOAuthGrantProviders: () => Promise.resolve([]),
    listPushChannels: () => Promise.resolve([]),
    redis,
    residue: {
      clear: () => Promise.resolve(),
      deleteForUser: () => Promise.resolve(0),
      list: () => Promise.resolve([]),
      purgeOrphaned: () => Promise.resolve([]),
      record: () => Promise.resolve(),
      spendRepairAttempt: () =>
        Promise.reject(new Error("the teardown never spends a repair attempt")),
    },
  } as never);

  const rejection: unknown = await teardown(USER_ID).then(
    () => {
      throw new Error(
        "teardown resolved, so better-auth deletes the user row with no durable halt signal "
          + "standing and an in-flight sync keeps removing the deleted customer's events",
      );
    },
    (error: unknown) => error,
  );

  return { listCalendarIdsCalls, rejection };
};

describe("a tombstone that cannot be established", () => {
  it(
    "blocks the delete for both an immediate redis rejection and a write that outruns its deadline",
    async () => {
      const rejected = await runTeardownAgainst(createReadOnlyReplicaRedis());

      expect(rejected.rejection).toBeInstanceOf(Error);
      expect((rejected.rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
      expect(rejected.listCalendarIdsCalls).toBe(0);

      const hung = await runTeardownAgainst(createHungFirstSetRedis());

      expect(hung.rejection).toBeInstanceOf(Error);
      expect((hung.rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
      expect(hung.listCalendarIdsCalls).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
