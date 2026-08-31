import { describe, expect, it } from "vitest";
import {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  PRESENT_ANSWER_FRESHNESS_MS,
  unconfirmedDeletionMarkerKey,
} from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "user-1";

describe("a tombstoned user's sync never trusts a cached present answer", () => {
  it("re-probes the user row on the provisional branch after the row is deleted", async () => {
    const keys = new Set<string>();
    const counters = { userRowProbes: 0 };
    const probeErrors: unknown[] = [];
    let clockMs = 1_000_000;
    let userRowPresent = true;

    const check = createUserDeletedCheck(
      {
        exists: (key: string) => Promise.resolve(keys.has(key) ? 1 : 0),
      },
      USER_ID,
      {
        freshnessWindowMs: PRESENT_ANSWER_FRESHNESS_MS,
        isUserRowPresent: () => {
          counters.userRowProbes += 1;
          return Promise.resolve(userRowPresent);
        },
        now: () => clockMs,
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);

    keys.add(deletedUserTombstoneKey(USER_ID));
    keys.add(unconfirmedDeletionMarkerKey(USER_ID));
    clockMs += 500;
    userRowPresent = false;

    expect(await check()).toBe(true);
    expect(counters.userRowProbes).toBe(2);
    expect(probeErrors).toEqual([]);
  });
});
