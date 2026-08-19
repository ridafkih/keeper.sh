import { describe, expect, it } from "vitest";
import Redis from "ioredis";
import { isIngestInfrastructureError, requiresReauthentication } from "../../src/utils/error-flags";

/*
 * Shutdown ordering (services/cron/src/index.ts:28-33) runs baker.stopAll();
 * destroy(); shutdownRefreshLockRedis(); await shutdownDatabases(). stopAll
 * stops FUTURE passes but does not wait for the in-flight pass, and
 * shutdownRefreshLockRedis (context.ts:76-78) is a bare
 * refreshLockRedis.disconnect() that executes before the 2s flush drain. Every
 * mid-flight ingest task's next Redis operation on that client — the
 * sourceIngestLock isCurrent probe (packages/sync/src/sync-lock.ts:224-231,
 * called from ingest.ts:260 inside runSourceIngest's work with no local
 * catch), the rate limiter's eval, the Outlook lease SET — then rejects with
 * ioredis's bare "Connection is closed." Error.
 *
 * That rejection never contacted the calendar's provider, but it carries no
 * flag and matches no exemption in error-flags.ts, so runSourceIngest's catch
 * (ingest-sources.ts:258-262) applies exponential provider ingest backoff —
 * and the write lands, because the pooled `database` stays open through the
 * drain window (context.ts:29-47). The same "shutdown must not punish
 * innocent calendars" invariant was already wired for
 * SerialFlushWorkerClosedError; this asserts it for the Redis-teardown
 * channel. On current code the classifier treats the teardown error as a
 * provider failure, so this test FAILS, proving the issue.
 */

// Exact mirror of ingest-sources.ts:278-279 (the predicate is not exported).
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

// Mirror of the refreshLockRedis construction in context.ts:68-72.
const buildRefreshLockRedis = (): Redis =>
  new Redis("redis://127.0.0.1:1", {
    commandTimeout: 10_000,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

describe("refreshLockRedis teardown during an in-flight ingest", () => {
  it("does not qualify the connection-closed rejection for provider backoff", async () => {
    const refreshLockRedis = buildRefreshLockRedis();
    // Mirror of shutdownRefreshLockRedis (context.ts:76-78) firing mid-pass.
    refreshLockRedis.disconnect();

    let caught: unknown = null;
    try {
      // The isCurrent probe's round trip (sync-lock.ts:221) after teardown.
      await refreshLockRedis.get("source-ingest:calendar-1");
    } catch (error) {
      caught = error;
    }

    // Guard: this is the exact ioredis teardown rejection, nothing synthetic.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Connection is closed.");

    // Keeper tore down its own Redis client; the provider never misbehaved.
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
