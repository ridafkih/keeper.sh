import { describe, expect, it } from "vitest";
import {
  isIngestInfrastructureError,
  requiresReauthentication,
} from "../../src/utils/error-flags";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";

/*
 * A provider that hangs (or is persistently slow past the 120s source
 * deadline) surfaces as the SAME OperationTimeoutError that withAbortTimeout
 * raises for budget-starvation and shutdown cases (with-abort-timeout.ts:35
 * aborts on ANY deadline overrun with no cause discrimination). The
 * infrastructure exemption in error-flags.ts:24-28 therefore also exempts
 * provider-caused timeouts, and every backoff gate consumes it:
 *
 * - OAuth: shouldApplyOAuthIngestBackoff (ingest-sources.ts:278-279) is
 *   !requiresReauthentication(error), which folds in the exemption.
 * - CalDAV (ingest-sources.ts:1503-1505) and ICS (:1674) both gate on
 *   !isIngestInfrastructureError(error).
 *
 * Desired property asserted here: a timeout produced purely by a hung
 * provider fetch — no keeper flush budget, writer, or database involved —
 * MUST still qualify the calendar for ingest backoff, so the predicates
 * below must return true. On current code the blanket OperationTimeoutError
 * exemption makes them return false, so these expectations FAIL, proving a
 * hung/slow provider is retried at full cron cadence forever.
 */

// Exact mirror of ingest-sources.ts:278-279 (the predicate is not exported).
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

// Exact mirror of the ICS gate at ingest-sources.ts:1674 (CalDAV at
// :1503-1505 adds only an auth-failure clause that a timeout never trips).
const shouldApplyIcsIngestBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const SHORT_DEADLINE_MS = 30;

// A provider hang: never settles, never touches keeper infrastructure.
// eslint-disable-next-line no-empty-function -- The empty executor IS the hang under test; per repo precedent in tests/utils/ingest-scheduling-herd.test.ts.
const hungProviderFetch = (): Promise<never> => new Promise<never>(() => {});

describe("provider-caused source timeouts versus ingest backoff", () => {
  it("qualifies a hung provider's deadline timeout for provider backoff", async () => {
    let caught: unknown = null;
    try {
      await withAbortTimeout(() => hungProviderFetch(), SHORT_DEADLINE_MS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OperationTimeoutError);

    /*
     * The provider was contacted and failed to answer within the source
     * deadline — that IS evidence of provider misbehavior, and on the
     * provider-rate-protection branch it must accrue ingestFailureCount.
     * The blanket exemption returns false here on current code.
     */
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(true);
    expect(shouldApplyIcsIngestBackoff(caught)).toBe(true);
  });
});
