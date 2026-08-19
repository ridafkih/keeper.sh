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
 * The shared per-host budget and the Outlook account semaphore both park
 * BEFORE the first provider request, and on deadline reject with a bare
 * unflagged signal.reason (only the flush worker's reserve() stamps the
 * infrastructure flag). Unflagged, every family's backoff gate punishes a
 * calendar whose provider was never contacted.
 */

/* Mirrors of the production gates, which are not exported. */
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const shouldApplyHostFamilyBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const SHORT_DEADLINE_MS = 60;
/* Occupancy at the 30rpm host cap: the window is full, so retry in 500ms. */
const FULL_WINDOW_DECISION = [500, 30];

const fullWindowRedis = {
  eval: (): Promise<unknown> => Promise.resolve(FULL_WINDOW_DECISION),
};

const exhaustedLeaseRedis = {
  del: (): Promise<number> => Promise.resolve(0),
  // SET NX answers null while all of the account's leases are held.
  set: (): Promise<string | null> => Promise.resolve(null),
};

describe("pre-contact parks versus provider ingest backoff", () => {
  it("exempts a host-limiter park that timed out before any provider request", async () => {
    const limiter = createHostRateLimiter(fullWindowRedis, "caldav.icloud.com");
    let caught: unknown = null;
    try {
      await withAbortTimeout(async (signal) => {
        await limiter.acquire(1, signal);
      }, SHORT_DEADLINE_MS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyHostFamilyBackoff(caught)).toBe(false);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });

  it("exempts an Outlook semaphore park that timed out before any provider request", async () => {
    const semaphore = createOutlookAccountSemaphore(exhaustedLeaseRedis, "account-1");
    let caught: unknown = null;
    try {
      await withAbortTimeout(async (signal) => {
        await semaphore.acquireLease(signal);
      }, SHORT_DEADLINE_MS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
