import { describe, expect, it } from "vitest";
import {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  unconfirmedDeletionMarkerKey,
} from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "user-1";

const TOMBSTONE_KEY = deletedUserTombstoneKey(USER_ID);
const UNCONFIRMED_KEY = unconfirmedDeletionMarkerKey(USER_ID);

const createFakeRedis = (present: Set<string>, failingKeys = new Set<string>()) => {
  const reads: string[] = [];
  const store = new Map<string, string>();

  for (const key of present) {
    store.set(key, "1");
  }

  return {
    reads,
    client: {
      del: (key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      },
      exists: (key: string) => {
        reads.push(key);
        if (failingKeys.has(key)) {
          return Promise.reject(new Error(`redis unavailable for ${key}`));
        }
        return Promise.resolve(store.has(key) ? 1 : 0);
      },
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      },
    },
  };
};

describe("a provisional tombstone defers to the user row", () => {
  it("clears the check when the user row is confirmed present", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY, UNCONFIRMED_KEY]));
    const counters = { userRowProbes: 0 };

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(true);
      },
    });

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
    expect(redis.reads).toContain(UNCONFIRMED_KEY);
  });

  it("keeps the fast path for a confirmed tombstone", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY]));
    const counters = { userRowProbes: 0 };

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(true);
      },
    });

    expect(await check()).toBe(true);
    expect(counters.userRowProbes).toBe(0);
  });

  it("holds the tombstone when the user row probe rejects", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY, UNCONFIRMED_KEY]));
    const probeErrors: unknown[] = [];

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      isUserRowPresent: () => Promise.reject(new Error("database unreachable")),
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(true);
    expect(probeErrors).toHaveLength(1);
  });

  it("holds the tombstone when the user row is absent", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY, UNCONFIRMED_KEY]));

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      isUserRowPresent: () => Promise.resolve(false),
    });

    expect(await check()).toBe(true);
  });

  it("holds the tombstone when there is no fallback probe", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY, UNCONFIRMED_KEY]));

    const check = createUserDeletedCheck(redis.client, USER_ID);

    expect(await check()).toBe(true);
  });

  it("defers to the user row when the companion key read fails", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY]), new Set([UNCONFIRMED_KEY]));
    const counters = { userRowProbes: 0 };

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(true);
      },
    });

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
  });
});
