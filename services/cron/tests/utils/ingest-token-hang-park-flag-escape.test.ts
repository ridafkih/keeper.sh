import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * Only a timeout observed while parked on keeper's own pacing may stay exempt
 * from ingest backoff. A deadline eaten by a non-signal-aware provider wait
 * must still accrue backoff — even though the abandoned run later touches
 * reserve(), whose already-aborted entry check stamps the park flag on the
 * shared timeout error in place.
 */

/* Mirror of the production gate, which is not exported. */
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const DEADLINE_MS = 20;
const TOKEN_ENDPOINT_HANG_MS = 60;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("provider token-endpoint hang versus the pre-contact park exemption", () => {
  it("still applies backoff when the abandoned run hits an idle reserve after the deadline", async () => {
    const worker = createSerialFlushWorker(
      (task: () => Promise<number>) => task(),
      { budget: 1024, capacity: 50 },
    );

    let abandonedRunError: unknown = null;
    let abandonedRunWouldBackoff: boolean | null = null;
    let abandonedRunSettled: (() => void) | null = null;
    const abandonedRunDone = new Promise<void>((resolve) => {
      abandonedRunSettled = resolve;
    });

    let foregroundError: unknown = null;
    try {
      await withAbortTimeout(async (signal) => {
        try {
          // Stand-in for ensureValidToken, which takes no abort signal.
          await sleep(TOKEN_ENDPOINT_HANG_MS);
          /* The worker is idle, so absent the abort this reserve grants instantly. */
          const reservation = await worker.reserve(1, signal);
          reservation.release();
          return 0;
        } catch (error) {
          abandonedRunError = error;
          abandonedRunWouldBackoff = shouldApplyOAuthIngestBackoff(error);
          throw error;
        } finally {
          abandonedRunSettled?.();
        }
      }, DEADLINE_MS);
    } catch (error) {
      foregroundError = error;
    }

    expect(foregroundError).toBeInstanceOf(OperationTimeoutError);

    await abandonedRunDone;
    await worker.close();

    /* Both runs reject with the one shared error object the flag is stamped on. */
    expect(abandonedRunError).toBe(foregroundError);

    expect(abandonedRunWouldBackoff).toBe(true);
  });
});
