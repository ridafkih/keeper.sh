import { describe, expect, it, vi } from "vitest";

/*
 * Pins the OTHER half of the shutdown ordering. The flush drain
 * (context.ts:29-45) exists so "queued and in-flight flushes settle before
 * the dedicated single-connection flushDatabase is closed" — but a drained
 * flush only commits if its persist-time currency re-probe
 * (packages/calendar/src/core/sync-engine/ingest.ts:308-313) answers
 * "current". That probe is a redis.eval on the sync-lock handle backed by
 * refreshLockRedis (packages/sync/src/sync-lock.ts:224-236,
 * ingest-sources.ts:125-143). The cleanup in src/index.ts runs
 * shutdownRefreshLockRedis() BEFORE await shutdownDatabases(), so by the
 * time the drain pumps a queued flush the client rejects every command,
 * probeCurrency (ingest.ts:203-210) reports "currency-unconfirmed", and the
 * flush returns EMPTY_RESULT without flushing: the drain "succeeds" while
 * every payload it was built to persist is silently discarded. This test
 * drives the REAL src/index.ts cleanup, the REAL context/flush-drain
 * machinery, and the REAL ingestSource persist-time probe; only the
 * process-boundary pieces (entrykit, env, databases, ioredis, polar,
 * premium) are stubbed. On current code the parked flush is discarded as
 * currency-unconfirmed, so this test FAILS, proving the issue.
 */

interface HarnessState {
  cleanup: (() => Promise<void>) | null;
}

const harness = vi.hoisted((): HarnessState => ({
  cleanup: null,
}));

vi.mock("entrykit", () => ({
  entry: async (options: { main: () => Promise<() => Promise<void>> }): Promise<void> => {
    harness.cleanup = await options.main();
  },
}));

vi.mock("../src/env", () => ({
  default: {
    COMMERCIAL_MODE: false,
    DATABASE_POOL_MAX: 10,
    DATABASE_URL: "postgres://cron-test/keeper",
    REDIS_URL: "redis://cron-test:6379",
    WORKER_JOB_QUEUE_ENABLED: false,
  },
}));

vi.mock("../src/migration-check", () => ({
  checkWorkerMigrationStatus: (): void => {
    // The real check may process.exit(1); the stub keeps the test alive.
  },
}));

vi.mock("../src/utils/logging", () => ({
  destroy: (): void => {
    // Logging teardown is out of scope here.
  },
}));

vi.mock("../src/utils/get-jobs", () => ({
  // No scheduled jobs: the parked flush is injected through the drain registry.
  getAllJobs: (): Promise<unknown[]> => Promise.resolve([]),
}));

vi.mock("@keeper.sh/database", () => ({
  closeDatabase: (): void => {
    // Pool teardown is out of scope here.
  },
  createDatabase: (): Promise<object> => Promise.resolve({}),
  createMigrationReadinessDatabase: (): object => ({}),
  waitForDatabaseMigrations: (): Promise<void> => Promise.resolve(),
}));

vi.mock("@keeper.sh/premium", () => ({
  createPremiumService: (): object => ({}),
}));

vi.mock("@polar-sh/sdk", () => ({
  // The member keeps oxlint's no-extraneous-class satisfied on this stub.
  Polar: class FakePolar {
    public readonly mocked = true;
  },
}));

/*
 * Mirror of ioredis teardown semantics: after disconnect() the client
 * rejects every command with the bare "Connection is closed." Error — the
 * exact rejection the persist-time probe sees during shutdown.
 */
vi.mock("ioredis", () => ({
  default: class FakeRedis {
    public closed = false;

    public disconnect(): void {
      this.closed = true;
    }

    public eval(): Promise<number> {
      if (this.closed) {
        return Promise.reject(new Error("Connection is closed."));
      }
      return Promise.resolve(1);
    }
  },
}));

describe("SIGTERM cleanup and the flush drain's currency probe", () => {
  it("keeps refreshLockRedis alive until drained flushes have committed", async () => {
    await import("../src/index");
    const { refreshLockRedis } = await import("../src/context");
    const { registerFlushDrain } = await import("../src/utils/flush-drains");
    const { ingestSource } = await import("@keeper.sh/calendar");

    expect(harness.cleanup).not.toBeNull();

    /*
     * Mirror of the sourceIngestLock handle's isCurrent
     * (packages/sync/src/sync-lock.ts:224-236): a redis.eval round trip on
     * the very client shutdownRefreshLockRedis disconnects.
     */
    const isCurrent = async (): Promise<boolean> => {
      const current = await (refreshLockRedis as {
        eval: (...args: unknown[]) => Promise<unknown>;
      }).eval("is-current-script", 2, "lock:calendar-1", "waiter:calendar-1", "holder-1");
      return current === 1;
    };

    /*
     * Park one flush exactly as a live source would at deploy time: payload
     * fully fetched, pre-enqueue probe passed, transaction thunk waiting in
     * the serial flush queue for the drain to pump it.
     */
    const queuedThunks: (() => void)[] = [];
    let flushCommitted = false;
    let recordedOutcome = "";

    const ingestRun = ingestSource({
      calendarId: "calendar-1",
      fetchEvents: () => Promise.resolve({
        events: [],
        nextSyncToken: "sync-token-after-fetch",
      }),
      isCurrent,
      onIngestEvent: (event) => {
        recordedOutcome = String(event["outcome"]);
      },
      withPersistenceTransaction: (work) => new Promise((resolve) => {
        queuedThunks.push(() => {
          resolve(work({
            flush: (): Promise<void> => {
              flushCommitted = true;
              return Promise.resolve();
            },
            readExistingEvents: () => Promise.resolve([]),
          }));
        });
      }),
    });

    /* Let the fetch and the pre-enqueue probe settle so the thunk parks. */
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(queuedThunks).toHaveLength(1);

    let drained = false;
    registerFlushDrain(async () => {
      for (const runThunk of queuedThunks.splice(0)) {
        runThunk();
      }
      await ingestRun;
      drained = true;
    });

    await harness.cleanup?.();

    /* The drain itself completes either way — that is what masks the loss. */
    expect(drained).toBe(true);

    /*
     * The whole point of draining before closing the flush database is that
     * the queued flush PERSISTS. If refreshLockRedis was disconnected first,
     * the persist-time probe answers "currency-unconfirmed" and the payload
     * is silently discarded.
     */
    expect(recordedOutcome).not.toBe("currency-unconfirmed");
    expect(flushCommitted).toBe(true);
  });
});
