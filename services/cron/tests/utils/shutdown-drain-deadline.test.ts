import { describe, expect, it, vi } from "vitest";
import { registerFlushDrain } from "../../src/utils/flush-drains";
import { createSerialFlushWorker } from "../../../../packages/calendar/src/core/utils/serial-flush-worker";

/*
 * SIGTERM triggers entrykit's cleanup, which awaits shutdownDatabases().
 * shutdownDatabases awaits drainFlushWriters() with no deadline, and the
 * registered drain in production is ingestFlushWriter.close(), which resolves
 * only when the pump goes idle. A single wedged flush (a run() that never
 * settles, e.g. a half-open connection) therefore turns graceful shutdown
 * into a permanent hang: closeDatabase never runs and the process lingers
 * until the supervisor SIGKILLs it. This test pins that shutdown must settle
 * within a bounded time even when one flush is wedged.
 */

const TEST_DATABASE_URL = "postgres://cron-test/keeper";
const SHUTDOWN_DEADLINE_MS = 3000;
const WEDGED_ITEM_CLIENT_DEADLINE_MS = 5000;

const mocks = vi.hoisted(() => {
  const closeDatabase = vi.fn();
  const createDatabase = vi.fn(() => Promise.resolve({ name: "fake-database" }));
  return { closeDatabase, createDatabase };
});

vi.mock("../../src/env", () => ({
  default: {
    COMMERCIAL_MODE: false,
    DATABASE_POOL_MAX: 10,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: "redis://cron-test:6379",
  },
}));

vi.mock("@keeper.sh/database", () => ({
  closeDatabase: mocks.closeDatabase,
  createDatabase: mocks.createDatabase,
}));

vi.mock("ioredis", () => ({
  // The flag gives disconnect a `this` use so oxlint accepts the stub.
  default: class FakeRedis {
    public connected = true;

    public disconnect(): void {
      this.connected = false;
    }
  },
}));

vi.mock("@keeper.sh/premium", () => ({
  createPremiumService: () => ({}),
}));

vi.mock("@keeper.sh/calendar", () => ({
  resolveWebhookConfig: () => null,
}));

vi.mock("@polar-sh/sdk", () => ({
  // The member keeps oxlint's no-extraneous-class satisfied on this stub.
  Polar: class FakePolar {
    public readonly mocked = true;
  },
}));

describe("shutdown drain deadline", () => {
  it("settles shutdownDatabases within a bounded time even when one flush is wedged", async () => {
    const context = await import("../../src/context");
    const { shutdownDatabases } = context as unknown as {
      shutdownDatabases: () => Promise<void>;
    };

    /*
     * A wedged flush: run() never settles, exactly the half-open-connection
     * scenario the serial-flush-worker's own comments describe. The pump
     * awaits it to settlement, so close() waits forever on idleWaiters.
     */
    const wedgedWorker = createSerialFlushWorker<{ deadlineAt: number }, null>(
      () => new Promise<null>(() => {
        // Never settles: models the half-open connection.
      }),
    );
    const wedgedSubmit = wedgedWorker.submit({
      // A short client deadline so the run's timer does not outlive the test.
      deadlineAt: Date.now() + WEDGED_ITEM_CLIENT_DEADLINE_MS,
    });
    // The client-side deadline rejects the caller; the run stays wedged.
    wedgedSubmit.catch(() => null);

    // Mirrors ingest-sources.ts: registerFlushDrain(() => ingestFlushWriter.close()).
    registerFlushDrain(() => wedgedWorker.close());

    let shutdownState = "still-draining";
    const shutdown = shutdownDatabases().then(() => {
      shutdownState = "completed";
      return null;
    });
    shutdown.catch(() => null);

    await new Promise((resolve) => {
      setTimeout(resolve, SHUTDOWN_DEADLINE_MS);
    });

    /*
     * Graceful shutdown must complete within the bound: without a drain
     * deadline this stays "still-draining" forever and closeDatabase is
     * never reached for either database instance.
     */
    expect(shutdownState).toBe("completed");
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(2);
  });
});
