import { describe, expect, it, vi } from "vitest";

/*
 * A drained flush only commits if its persist-time currency re-probe answers
 * "current", and that probe is a redis.eval on refreshLockRedis. Disconnect
 * that client before the drain and the drain still "succeeds" while every
 * payload it was built to persist is silently discarded.
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
    // The real check may process.exit(1).
  },
}));

vi.mock("../src/utils/logging", () => ({
  destroy: (): void => {
    // Intentionally empty.
  },
}));

vi.mock("../src/utils/get-jobs", () => ({
  getAllJobs: (): Promise<unknown[]> => Promise.resolve([]),
}));

vi.mock("@keeper.sh/database", () => ({
  closeDatabase: (): void => {
    // Intentionally empty.
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

/* Mirrors ioredis: after disconnect() every command rejects "Connection is closed." */
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

    const isCurrent = async (): Promise<boolean> => {
      const current = await (refreshLockRedis as {
        eval: (...args: unknown[]) => Promise<unknown>;
      }).eval("is-current-script", 2, "lock:calendar-1", "waiter:calendar-1", "holder-1");
      return current === 1;
    };

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

    /* The drain completes either way — that is what masks the loss. */
    expect(drained).toBe(true);

    expect(recordedOutcome).not.toBe("currency-unconfirmed");
    expect(flushCommitted).toBe(true);
  });
});
