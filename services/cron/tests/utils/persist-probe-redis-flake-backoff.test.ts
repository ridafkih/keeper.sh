import { ingestSource } from "@keeper.sh/calendar";
import type { SourceEvent } from "@keeper.sh/calendar";
import { SyncLockRenewalError } from "@keeper.sh/sync";
import { describe, expect, it } from "vitest";
import {
  isIngestInfrastructureError,
  requiresReauthentication,
} from "../../src/utils/error-flags";

/*
 * The currency probe is two Redis round trips on keeper's own refreshLockRedis,
 * so it can flake on a calendar whose provider fetch SUCCEEDED. A probe that
 * cannot answer must not commit the flush (the lease may be lost) and must not
 * surface as a provider failure: the run either contains the flake, or escapes
 * with an error every backoff gate exempts.
 */

const CALENDAR_ID = "calendar-persist-probe-flake";

/* Mirrors of the production gates, which are not exported. */
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const shouldApplyHostFamilyBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const makeEvent = (uid: string, startHour: number): SourceEvent => ({
  availability: "busy",
  endTime: new Date(Date.UTC(2026, 7, 20, startHour + 1)),
  isAllDay: false,
  startTime: new Date(Date.UTC(2026, 7, 20, startHour)),
  title: uid,
  uid,
});

interface RunOutcome {
  caught: unknown;
  flushCount: number;
}

const runIngestWithProbe = async (
  isCurrent: () => Promise<boolean>,
): Promise<RunOutcome> => {
  let flushCount = 0;
  let caught: unknown = null;
  try {
    await ingestSource({
      calendarId: CALENDAR_ID,
      fetchEvents: () => Promise.resolve({ events: [makeEvent("event-x", 9)] }),
      isCurrent,
      withPersistenceTransaction: (work) => work({
        readExistingEvents: () => Promise.resolve([]),
        flush: () => {
          flushCount += 1;
          return Promise.resolve();
        },
      }),
    });
  } catch (error) {
    caught = error;
  }
  return { caught, flushCount };
};

const expectExemptFromEveryBackoffGate = (outcome: RunOutcome): void => {
  expect(outcome.flushCount).toBe(0);

  /* Containing the flake without flushing also satisfies the invariant. */
  if (outcome.caught === null) {
    return;
  }
  expect(isIngestInfrastructureError(outcome.caught)).toBe(true);
  expect(shouldApplyOAuthIngestBackoff(outcome.caught)).toBe(false);
  expect(shouldApplyHostFamilyBackoff(outcome.caught)).toBe(false);
};

describe("Redis flake in the ingest currency probe versus provider backoff", () => {
  it("exempts an ioredis flake at the persist-time re-probe from every family's backoff gate", async () => {
    /* The pre-enqueue probe passes; the persist-time re-probe blips. */
    let probeCalls = 0;
    const outcome = await runIngestWithProbe(() => {
      probeCalls += 1;
      if (probeCalls === 1) {
        return Promise.resolve(true);
      }
      return Promise.reject(new Error("Command timed out"));
    });
    expect(probeCalls).toBeGreaterThanOrEqual(2);
    expectExemptFromEveryBackoffGate(outcome);
  });

  it("exempts a single blipped renewal tick (SyncLockRenewalError) surfacing through the probe", async () => {
    /*
     * The lock handle throws on the first probe after one failed renewal tick,
     * even though a later tick would clear the flag.
     */
    const outcome = await runIngestWithProbe(() => Promise.reject(
      new SyncLockRenewalError(CALENDAR_ID, new Error("Command timed out")),
    ));
    expectExemptFromEveryBackoffGate(outcome);
  });
});
