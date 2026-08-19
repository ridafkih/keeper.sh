import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  NEVER_INGESTED_WEIGHT,
  WEIGHT_BUDGET,
} from "../../src/utils/ingest-weight";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * The reserveIngestFlushWeight call is awaited INSIDE runSourceIngest's work callback
 * (ingest-sources.ts:1196-1200, 1400-1404, 1571-1575) under the source's
 * 120s abort signal. When the shared 64MB budget is pinned (eight
 * NEVER_INGESTED_WEIGHT holds of budget/8 while their fetches sleep in
 * provider throttles), a parked reserve() rejects with the source's
 * OperationTimeoutError at its deadline; on shutdown, close() rejects every
 * parked reserver with "serial flush worker is closed". Neither error ever
 * touched the calendar's provider.
 *
 * Both rejections propagate to runSourceIngest's catch (lines 219-223),
 * where shouldApplyOAuthIngestBackoff (line 230: !requiresReauthentication)
 * classifies EVERY non-reauth error as a provider failure and applies
 * exponential ingest backoff (5min doubling to a 6h cap) to the calendar.
 *
 * Desired property asserted here: an error produced purely by flush-budget
 * starvation or writer shutdown must NOT qualify a calendar for provider
 * backoff. On current code the classifier returns true for both, so these
 * tests FAIL, proving the misclassification.
 */

// Exact mirror of ingest-sources.ts:230-231 (the predicate is not exported).
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const COLD_START_SOURCES = 8;
const SHORT_DEADLINE_MS = 50;

describe("flush-budget infrastructure errors versus provider backoff", () => {
  it("does not qualify a budget-starved reserve timeout for provider backoff", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );
    // Pin the budget exactly as eight concurrent cold-start sources do.
    const holds = await Promise.all(
      Array.from({ length: COLD_START_SOURCES }, () =>
        worker.reserve(NEVER_INGESTED_WEIGHT)),
    );
    expect(COLD_START_SOURCES * NEVER_INGESTED_WEIGHT).toBe(WEIGHT_BUDGET);

    /*
     * A ninth cold source parks in reserve()'s FIFO (budget/8 is far above
     * the budget/64 express-lane ceiling) and hits its source deadline, the
     * same withAbortTimeout mechanism that arms the production 120s signal.
     */
    let caught: unknown = null;
    try {
      await withAbortTimeout(
        (signal) => worker.reserve(NEVER_INGESTED_WEIGHT, signal),
        SHORT_DEADLINE_MS,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    /*
     * The calendar's provider was never contacted. runSourceIngest's catch
     * must not hand this error to applyIngestBackoff — yet the production
     * classifier exempts only reauthentication errors, so this expect fails
     * with true on current code.
     */
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);

    for (const hold of holds) {
      hold.release();
    }
    await worker.close();
  });

  it("does not qualify a shutdown-rejected parked reserve for provider backoff", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );
    const holds = await Promise.all(
      Array.from({ length: COLD_START_SOURCES }, () =>
        worker.reserve(NEVER_INGESTED_WEIGHT)),
    );

    // A parked reserver caught by shutdown: close() rejects it outright.
    let caught: unknown = null;
    const parked = worker.reserve(NEVER_INGESTED_WEIGHT).catch((error: unknown) => {
      caught = error;
      return null;
    });
    await worker.close();
    await parked;
    for (const hold of holds) {
      hold.release();
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("serial flush worker is closed");

    /*
     * Same misclassification on the shutdown path: a writer-closed rejection
     * is infrastructure, not a provider failure, but the classifier returns
     * true and the calendar is written an exponential backoff anyway.
     */
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
