import {
  createHostRateLimiter,
  createOutlookAccountSemaphore,
} from "@keeper.sh/calendar";
import { describe, expect, it } from "vitest";
import {
  isIngestInfrastructureError,
  requiresReauthentication,
} from "../../src/utils/error-flags";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";

/*
 * Reserve-before-fetch is not the only keeper-internal park that precedes any
 * provider contact. Two more sit on the same side of the first provider
 * request:
 *
 * - The shared per-host CalDAV/ICS budget: acquire(1, signal) is awaited at
 *   ingest-sources.ts:1643 (and in every onBeforeRequest at :1450-1452)
 *   BEFORE the corresponding origin request is sent. When the 30rpm window is
 *   full, waitForRetry (redis-rate-limiter.ts:98-117) parks and, on deadline,
 *   rejects with the bare signal.reason — an unflagged OperationTimeoutError.
 * - The Outlook account semaphore: the adapter at ingest-sources.ts:689-694
 *   awaits semaphore.acquireLease(signal); with all 3 slots leased,
 *   sleepWithSignal (leased-semaphore.ts:29-47) parks the retry loop and on
 *   deadline likewise rejects with the bare unflagged signal.reason.
 *
 * The serialFlushReserveAborted flag is stamped only inside the flush
 * worker's reserve() (serial-flush-worker.ts fast path and parked onAbort),
 * so these two pre-contact parks reach isIngestInfrastructureError unflagged,
 * the predicate returns false, and every family's gate —
 * shouldApplyOAuthIngestBackoff at ingest-sources.ts:278-279, CalDAV at
 * :1503-1505, ICS at :1674 — applies exponential provider backoff to a
 * calendar whose provider was never contacted. These expectations assert the
 * stated invariant ("the provider was never contacted yet ... stays exempt")
 * and FAIL on current code.
 */

// Exact mirror of ingest-sources.ts:278-279 (the predicate is not exported).
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

// Exact mirror of the ICS gate at ingest-sources.ts:1674 (CalDAV at
// :1503-1505 adds only an auth-failure clause that a timeout never trips).
const shouldApplyHostFamilyBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const SHORT_DEADLINE_MS = 60;
// Occupancy at the 30rpm host cap: the window is full, so retry in 500ms.
const FULL_WINDOW_DECISION = [500, 30];

// A shared-host window that is always full: every charged acquire must park.
const fullWindowRedis = {
  eval: (): Promise<unknown> => Promise.resolve(FULL_WINDOW_DECISION),
};

// An account whose 3 slots are all leased: every SET NX comes back unclaimed.
const exhaustedLeaseRedis = {
  del: (): Promise<number> => Promise.resolve(0),
  set: (): Promise<string | null> => Promise.resolve(null),
};

describe("pre-contact parks versus provider ingest backoff", () => {
  it("exempts a host-limiter park that timed out before any provider request", async () => {
    const limiter = createHostRateLimiter(fullWindowRedis, "caldav.icloud.com");
    let caught: unknown = null;
    try {
      // Mirror of ingest-sources.ts:1643 — permit precedes the origin request.
      await withAbortTimeout(async (signal) => {
        await limiter.acquire(1, signal);
      }, SHORT_DEADLINE_MS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    /*
     * The deadline burned out while parked on keeper's own shared-host
     * pacing; no request ever left for the provider, so per the invariant
     * this must be infrastructure and must not accrue provider backoff.
     */
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyHostFamilyBackoff(caught)).toBe(false);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });

  it("exempts an Outlook semaphore park that timed out before any provider request", async () => {
    const semaphore = createOutlookAccountSemaphore(exhaustedLeaseRedis, "account-1");
    let caught: unknown = null;
    try {
      // Mirror of the adapter at ingest-sources.ts:689-694.
      await withAbortTimeout(async (signal) => {
        await semaphore.acquireLease(signal);
      }, SHORT_DEADLINE_MS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    /*
     * The 4th concurrent calendar of an account parked on keeper's own
     * 3-slot concurrency cap; Graph was never contacted, so punishing the
     * calendar with exponential backoff misattributes keeper's cap to the
     * provider.
     */
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
