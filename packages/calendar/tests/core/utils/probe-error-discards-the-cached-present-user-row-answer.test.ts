import { describe, expect, it } from "vitest";
import {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  PRESENT_ANSWER_FRESHNESS_MS,
  unconfirmedDeletionMarkerKey,
} from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "user-1";

const TOMBSTONE_KEY = deletedUserTombstoneKey(USER_ID);
const UNCONFIRMED_KEY = unconfirmedDeletionMarkerKey(USER_ID);

const createFakeRedis = (present: Set<string>) => {
  const reads: string[] = [];
  const store = new Map<string, string>();

  for (const key of present) {
    store.set(key, "1");
  }

  return {
    reads,
    store,
    client: {
      del: (key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      },
      exists: (key: string) => {
        reads.push(key);
        return Promise.resolve(store.has(key) ? 1 : 0);
      },
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      },
    },
  };
};

describe("a probe error discards the cached present user row answer", () => {
  it("answers deleted for a provisional tombstone after an earlier call cached a present row", async () => {
    const redis = createFakeRedis(new Set<string>());
    const probeErrors: unknown[] = [];
    const clock = { nowMs: 1_000_000 };
    const rowPresence: { respond: () => Promise<boolean> } = { respond: () => Promise.resolve(true) };

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => rowPresence.respond(),
      now: () => clock.nowMs,
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(false);

    redis.store.set(TOMBSTONE_KEY, "1");
    redis.store.set(UNCONFIRMED_KEY, "1");
    rowPresence.respond = () => Promise.reject(new Error("pool timeout"));
    clock.nowMs += 600_000;

    expect(await check()).toBe(true);
    expect(probeErrors).toHaveLength(1);
    expect((probeErrors[0] as Error).message).toBe("pool timeout");
  });

  it("returns to not deleted once the user row probe succeeds again", async () => {
    const redis = createFakeRedis(new Set([TOMBSTONE_KEY, UNCONFIRMED_KEY]));
    const probeErrors: unknown[] = [];
    const clock = { nowMs: 2_000_000 };
    const rowPresence: { respond: () => Promise<boolean> } = {
      respond: () => Promise.reject(new Error("pool timeout")),
    };

    const check = createUserDeletedCheck(redis.client, USER_ID, {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => rowPresence.respond(),
      now: () => clock.nowMs,
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(true);

    rowPresence.respond = () => Promise.resolve(true);
    clock.nowMs += 600_000;

    expect(await check()).toBe(false);
    expect(probeErrors).toHaveLength(1);
  });
});
