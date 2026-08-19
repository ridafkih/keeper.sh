import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import {
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

const SHORT_DEADLINE_MS = 50;

describe("flush-budget infrastructure errors versus provider backoff", () => {
  it("does not qualify a budget-starved reserve timeout for provider backoff", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );
    const hold = await worker.reserve(WEIGHT_BUDGET);

    let caught: unknown = null;
    try {
      await withAbortTimeout(
        (signal) => worker.reserve(WEIGHT_BUDGET, signal),
        SHORT_DEADLINE_MS,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);

    hold.release();
    await worker.close();
  });

  it("does not qualify a shutdown-rejected parked reserve for provider backoff", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: WEIGHT_BUDGET, capacity: 50 },
    );
    const hold = await worker.reserve(WEIGHT_BUDGET);

    let caught: unknown = null;
    const parked = worker.reserve(WEIGHT_BUDGET).catch((error: unknown) => {
      caught = error;
      return null;
    });
    await worker.close();
    await parked;
    hold.release();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("serial flush worker is closed");

    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
