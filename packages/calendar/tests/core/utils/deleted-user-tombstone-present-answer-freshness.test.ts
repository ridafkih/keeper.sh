import { describe, expect, it } from "vitest";
import { createUserDeletedCheck } from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "user-1";
const FRESHNESS_WINDOW_MS = 30_000;
const CHUNK_BOUNDARY_CALLS = 100;

describe("a live user's sync does not probe the user table at every chunk boundary", () => {
  it("reuses an observed present answer for a bounded freshness window", async () => {
    const counters = { redisExists: 0, userRowProbes: 0 };
    const probeErrors: unknown[] = [];
    let clockMs = 1_000_000;

    const check = createUserDeletedCheck(
      {
        exists: () => {
          counters.redisExists += 1;
          return Promise.resolve(0);
        },
      },
      USER_ID,
      {
        freshnessWindowMs: FRESHNESS_WINDOW_MS,
        isUserRowPresent: () => {
          counters.userRowProbes += 1;
          return Promise.resolve(true);
        },
        now: () => clockMs,
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    const answers: boolean[] = [];
    for (let call = 0; call < CHUNK_BOUNDARY_CALLS; call += 1) {
      answers.push(await check());
    }

    expect(answers).toEqual(Array.from({ length: CHUNK_BOUNDARY_CALLS }, () => false));
    expect(counters.userRowProbes).toBe(1);
    expect(probeErrors).toEqual([]);

    clockMs += FRESHNESS_WINDOW_MS + 1;

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(2);
  });
});
