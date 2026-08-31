import { describe, expect, it } from "vitest";
import { createUserDeletedCheck } from "../../../src/core/utils/deleted-user-tombstone";

const USER_ID = "user-1";
const FRESHNESS_WINDOW_MS = 30_000;
const WITHIN_WINDOW_MS = 25_000;

describe("a failed tombstone read invalidates the cached present answer", () => {
  it("reprobes the user row on the next check after a rejecting exists()", async () => {
    const counters = { userRowProbes: 0 };
    const probeErrors: unknown[] = [];
    const state = { rowPresent: true, existsRejects: false };
    let clockMs = 1_000_000;

    const check = createUserDeletedCheck(
      {
        exists: () => {
          if (state.existsRejects) {
            return Promise.reject(new Error("redis unavailable"));
          }
          return Promise.resolve(0);
        },
      },
      USER_ID,
      {
        freshnessWindowMs: FRESHNESS_WINDOW_MS,
        isUserRowPresent: () => {
          counters.userRowProbes += 1;
          return Promise.resolve(state.rowPresent);
        },
        now: () => clockMs,
        onProbeError: (error) => {
          probeErrors.push(error);
        },
      },
    );

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
    expect(probeErrors).toEqual([]);

    state.rowPresent = false;
    state.existsRejects = true;
    clockMs += WITHIN_WINDOW_MS;

    expect(await check()).toBe(true);
    expect(counters.userRowProbes).toBe(2);
  });

  it("keeps reusing the cached present answer while the tombstone read stays healthy", async () => {
    const counters = { userRowProbes: 0 };
    const state = { rowPresent: true };
    let clockMs = 2_000_000;

    const check = createUserDeletedCheck(
      {
        exists: () => Promise.resolve(0),
      },
      USER_ID,
      {
        freshnessWindowMs: FRESHNESS_WINDOW_MS,
        isUserRowPresent: () => {
          counters.userRowProbes += 1;
          return Promise.resolve(state.rowPresent);
        },
        now: () => clockMs,
      },
    );

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);

    state.rowPresent = false;
    clockMs += WITHIN_WINDOW_MS;

    expect(await check()).toBe(false);
    expect(counters.userRowProbes).toBe(1);
  });
});
