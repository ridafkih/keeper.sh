import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";
import { requiresReauthentication } from "../../src/utils/error-flags";

/*
 * The park-flag invariant (error-flags.ts:41-48): only a timeout observed
 * WHILE parked on keeper's own pacing — ahead of the provider request it
 * gates — may carry a park flag and stay exempt from ingest backoff. A
 * deadline consumed by a hung or persistently slow provider must accrue
 * backoff.
 *
 * The OAuth path violates this. ensureValidToken's token-refresh HTTP call
 * takes no abort signal (ingest-sources.ts:1212-1216 awaits it before
 * reserveIngestFlushWeight at 1250), so a slow provider token endpoint eats
 * the source's 120s deadline while withAbortTimeout's foreground rejects and
 * moves on. The abandoned run — which contains runSourceIngest and therefore
 * the backoff classification in its catch (lines 254-258) — keeps executing.
 * When the hung refresh finally resolves, the abandoned run reaches
 * ingestFlushWriter.reserve(weight, signal), whose already-aborted entry
 * check (serial-flush-worker.ts:412-415) stamps serialFlushReserveAborted on
 * the shared OperationTimeoutError IN PLACE, even though the abort was never
 * observed while parked — the worker is idle and would have granted
 * instantly. runSourceIngest's catch then classifies the now-stamped error:
 * requiresReauthentication -> isIngestInfrastructureError -> true, so no
 * backoff is ever applied and the provider-hung calendar retries every
 * minute forever.
 *
 * Desired property asserted here: a deadline consumed by a non-signal-aware
 * provider wait must still qualify for backoff even when the abandoned run
 * subsequently touches reserve(). On current code the entry check stamps the
 * park flag anyway, so the final expectation FAILS, proving the escape.
 */

// Exact mirror of ingest-sources.ts (the predicate is not exported).
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

    /*
     * Mirrors runSourceIngest's catch: the abandoned run classifies its own
     * rejection. Captured here so the test observes exactly what production
     * would hand to applyIngestBackoff after the stamp.
     */
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
          // Stand-in for ensureValidToken: no signal, hangs past the deadline.
          await sleep(TOKEN_ENDPOINT_HANG_MS);
          /*
           * The abandoned run resumes and reaches the flush reserve. The
           * worker is idle: absent the abort this grants immediately, so the
           * caller was never parked pre-contact — the deadline was consumed
           * by the provider's token endpoint.
           */
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

    // The foreground rejected at the deadline while the refresh still hung.
    expect(foregroundError).toBeInstanceOf(OperationTimeoutError);

    await abandonedRunDone;
    await worker.close();

    // The abandoned run rejected with the very same shared timeout reason.
    expect(abandonedRunError).toBe(foregroundError);

    /*
     * The deadline was eaten by a provider-side hang, not by parking on
     * keeper's own pacing, so the classification the abandoned run performs
     * must qualify the calendar for ingest backoff. On current code the
     * reserve entry check has stamped serialFlushReserveAborted on the shared
     * error before this catch ran, so this expectation fails with false.
     */
    expect(abandonedRunWouldBackoff).toBe(true);
  });
});
