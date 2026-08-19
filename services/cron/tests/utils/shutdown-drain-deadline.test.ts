import { describe, expect, it, vi } from "vitest";
import { registerFlushDrain } from "../../src/utils/flush-drains";
import { createSerialFlushWorker } from "../../../../packages/calendar/src/core/utils/serial-flush-worker";

/*
 * The registered drain is ingestFlushWriter.close(), which resolves only when
 * the pump goes idle, so without a deadline one wedged flush turns graceful
 * shutdown into a permanent hang: closeDatabase never runs.
 */

const TEST_DATABASE_URL = "postgres://cron-test/keeper";
const SHUTDOWN_DEADLINE_MS = 3000;
/* Outlives the shutdown bound, so the flush is still wedged when it is measured. */
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

    const wedgedWorker = createSerialFlushWorker<{ deadlineAt: number }, null>(
      () => new Promise<null>(() => {
        // Never settles: models a half-open connection.
      }),
    );
    const wedgedSubmit = wedgedWorker.submit({
      deadlineAt: Date.now() + WEDGED_ITEM_CLIENT_DEADLINE_MS,
    });
    /* The client deadline rejects the caller while the run itself stays wedged. */
    wedgedSubmit.catch(() => null);

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

    expect(shutdownState).toBe("completed");
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(2);
  });
});
