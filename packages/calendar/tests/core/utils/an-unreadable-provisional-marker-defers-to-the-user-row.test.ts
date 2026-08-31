import { describe, expect, it } from "vitest";
import {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  PRESENT_ANSWER_FRESHNESS_MS,
  unconfirmedDeletionMarkerKey,
} from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "u1";

const TOMBSTONE_KEY = deletedUserTombstoneKey(USER_ID);
const UNCONFIRMED_KEY = unconfirmedDeletionMarkerKey(USER_ID);

const redirectError = () => new Error("MOVED 1234 10.0.0.2:6379");

const createRedirectingRedis = () => ({
  exists: (key: string) => {
    if (key === TOMBSTONE_KEY) {
      return Promise.resolve(1);
    }
    if (key === UNCONFIRMED_KEY) {
      return Promise.reject(redirectError());
    }
    return Promise.reject(new Error(`unexpected read of ${key}`));
  },
});

const createHealthyRedis = (presentKeys: Set<string>) => ({
  exists: (key: string) => Promise.resolve(presentKeys.has(key) ? 1 : 0),
});

describe("an unreadable provisional marker defers to the user row", () => {
  it("keeps a live user syncing when the provisional marker read is redirected", async () => {
    const counters = { userRowProbes: 0 };
    const probeErrors: unknown[] = [];

    const check = createUserDeletedCheck(createRedirectingRedis(), USER_ID, {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(true);
      },
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
    expect(probeErrors).toHaveLength(1);
    expect((probeErrors[0] as Error).message).toBe("MOVED 1234 10.0.0.2:6379");
  });

  it("still reports a genuinely deleted user when the marker read is redirected", async () => {
    const counters = { userRowProbes: 0 };
    const probeErrors: unknown[] = [];

    const check = createUserDeletedCheck(createRedirectingRedis(), USER_ID, {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(false);
      },
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(true);
    expect(counters.userRowProbes).toBe(1);
    expect(probeErrors).toHaveLength(1);
  });

  it("leaves the healthy-redis answers unchanged", async () => {
    const probeErrors: unknown[] = [];
    const counters = { userRowProbes: 0 };

    const check = createUserDeletedCheck(createHealthyRedis(new Set()), USER_ID, {
      freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
      isUserRowPresent: () => {
        counters.userRowProbes += 1;
        return Promise.resolve(true);
      },
      onProbeError: (error) => {
        probeErrors.push(error);
      },
    });

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
    expect(probeErrors).toHaveLength(0);

    const confirmed = createUserDeletedCheck(
      createHealthyRedis(new Set([TOMBSTONE_KEY])),
      USER_ID,
      {
        freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
        isUserRowPresent: () => Promise.resolve(true),
      },
    );

    expect(await confirmed()).toBe(true);
  });
});
