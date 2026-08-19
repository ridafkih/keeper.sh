import { ingestSource } from "@keeper.sh/calendar";
import type { SourceEvent } from "@keeper.sh/calendar";
import { SyncLockRenewalError } from "@keeper.sh/sync";
import { describe, expect, it } from "vitest";
import {
  isIngestInfrastructureError,
  requiresReauthentication,
} from "../../src/utils/error-flags";

/*
 * The thrash-hunt fix added an isCurrent() re-probe inside the flush
 * transaction (ingest.ts:273) and kept the pre-enqueue probe (ingest.ts:260),
 * both with no error handling. isCurrent() is two Redis round trips on
 * refreshLockRedis (throwIfRenewalFailed + the IS_CURRENT_SCRIPT eval,
 * sync-lock.ts:224-236), so a transient rejection — an ioredis command
 * timeout, MaxRetriesPerRequestError, or a SyncLockRenewalError from a single
 * blipped renewal tick — propagates out of ingestSource as the ingest error.
 *
 * The exemption gate (error-flags.ts) recognizes only the literal teardown
 * message "Connection is closed." plus the flush-worker/pacing park flags, so
 * every family's shouldApplyBackoff predicate (OAuth at ingest-sources.ts:
 * 278-279, CalDAV at :1503-1505, ICS at :1674) applies exponential provider
 * ingest backoff for a keeper-Redis flake on a calendar whose provider fetch
 * SUCCEEDED. The sibling post-commit probe was hardened for exactly this
 * (resetIngestBackoffIfCurrent, ingest-sources.ts:203-223: "a Redis blip in
 * the probe ... must never feed the backoff escalator"); the persist-time
 * probe was not.
 *
 * Invariant under test: a currency probe that cannot answer must not commit
 * the flush (the lease may be lost), and it must not surface as a provider
 * failure — the run either contains the flake, or escapes with an error every
 * backoff gate exempts.
 */

const CALENDAR_ID = "calendar-persist-probe-flake";

// Exact mirror of ingest-sources.ts:278-279 (the predicate is not exported).
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

// Exact mirror of the ICS gate at ingest-sources.ts:1674 (CalDAV at
// :1503-1505 adds only an auth-failure clause a Redis flake never trips).
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

/*
 * Real ingestSource wired the way every cron family wires it: fetch succeeds
 * (the provider answered), the currency probe is the injected lock handle.
 */
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
  /* Currency unconfirmed: the snapshot must not have been committed. */
  expect(outcome.flushCount).toBe(0);

  /*
   * Containment (resolving without a flush, like the superseded path) also
   * satisfies the invariant; only an ESCAPING error must be exempt.
   */
  if (outcome.caught === null) {
    return;
  }
  expect(isIngestInfrastructureError(outcome.caught)).toBe(true);
  expect(shouldApplyOAuthIngestBackoff(outcome.caught)).toBe(false);
  expect(shouldApplyHostFamilyBackoff(outcome.caught)).toBe(false);
};

describe("Redis flake in the ingest currency probe versus provider backoff", () => {
  it("exempts an ioredis flake at the persist-time re-probe from every family's backoff gate", async () => {
    /*
     * An ioredis command timeout: the pre-enqueue probe passes, then the eval at
     * the persist-time re-probe blips. The provider fetch already succeeded.
     */
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
     * The handle's throwIfRenewalFailed (sync-lock.ts:213-217) throws on the FIRST probe
     * after one failed renewal tick, even though a later tick would clear the
     * flag ("a single blip must not strand the run").
     */
    const outcome = await runIngestWithProbe(() => Promise.reject(
      new SyncLockRenewalError(CALENDAR_ID, new Error("Command timed out")),
    ));
    expectExemptFromEveryBackoffGate(outcome);
  });
});
