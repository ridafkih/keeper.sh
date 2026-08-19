import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
  NEVER_INGESTED_WEIGHT,
  WEIGHT_BUDGET,
} from "../../src/utils/ingest-weight";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * A reserve() that times out on a pinned flush budget, or is rejected by
 * writer shutdown, never touched the calendar's provider — so it must not
 * qualify the calendar for exponential provider backoff.
 */

/* Mirror of the production gate, which is not exported. */
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
    const holds = await Promise.all(
      Array.from({ length: COLD_START_SOURCES }, () =>
        worker.reserve(NEVER_INGESTED_WEIGHT)),
    );
    expect(COLD_START_SOURCES * NEVER_INGESTED_WEIGHT).toBe(WEIGHT_BUDGET);

    /* Budget/8 is far above the budget/64 express lane, so a ninth source parks. */
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

    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
