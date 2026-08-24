import { describe, expect, it } from "vitest";
import {
  isIngestInfrastructureError,
  requiresReauthentication,
} from "../../src/utils/error-flags";
import { OperationTimeoutError, withAbortTimeout } from "../../src/utils/with-abort-timeout";

/*
 * A hung provider raises the same OperationTimeoutError as budget-starvation
 * and shutdown do, so a blanket infrastructure exemption would let a hung
 * provider escape backoff and be retried at full cron cadence forever.
 */

/* Mirrors of the production gates, which are not exported. */
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

const shouldApplyIcsIngestBackoff = (error: unknown): boolean =>
  !isIngestInfrastructureError(error);

const SHORT_DEADLINE_MS = 30;

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

    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(true);
    expect(shouldApplyIcsIngestBackoff(caught)).toBe(true);
  });
});
