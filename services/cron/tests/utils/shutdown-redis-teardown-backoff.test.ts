import { describe, expect, it } from "vitest";
import Redis from "ioredis";
import { isIngestInfrastructureError, requiresReauthentication } from "../../src/utils/error-flags";

/*
 * Shutdown disconnects refreshLockRedis while a pass is still in flight, so
 * every ingest task's next probe rejects with ioredis's bare "Connection is
 * closed." Shutdown must not punish innocent calendars: that rejection never
 * contacted the provider, yet the pooled database stays open long enough for
 * a backoff write to land.
 */

/* Mirror of the production gate, which is not exported. */
const shouldApplyOAuthIngestBackoff = (error: unknown): boolean =>
  !requiresReauthentication(error);

/* Mirror of the refreshLockRedis construction in src/context.ts. */
const buildRefreshLockRedis = (): Redis =>
  new Redis("redis://127.0.0.1:1", {
    commandTimeout: 10_000,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

describe("refreshLockRedis teardown during an in-flight ingest", () => {
  it("does not qualify the connection-closed rejection for provider backoff", async () => {
    const refreshLockRedis = buildRefreshLockRedis();
    refreshLockRedis.disconnect();

    let caught: unknown = null;
    try {
      await refreshLockRedis.get("source-ingest:calendar-1");
    } catch (error) {
      caught = error;
    }

    /* The exact ioredis teardown rejection, not a synthetic stand-in. */
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Connection is closed.");

    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(shouldApplyOAuthIngestBackoff(caught)).toBe(false);
  });
});
