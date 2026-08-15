import { describe, expect, it, vi } from "vitest";
import {
  waitForDatabaseMigrations,
  type MigrationReadinessDatabase,
} from "../../src/database/migration-readiness";

describe("waitForDatabaseMigrations", () => {
  it("waits until the post-migration runtime state is ready", async () => {
    vi.useFakeTimers();
    const database: MigrationReadinessDatabase = {
      isReady: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };

    const readiness = waitForDatabaseMigrations(database, 5000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(readiness).resolves.toBeUndefined();
    expect(database.isReady).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("fails closed when migrations never become ready", async () => {
    vi.useFakeTimers();
    const database: MigrationReadinessDatabase = {
      isReady: () => Promise.resolve(false),
    };

    const readiness = expect(waitForDatabaseMigrations(database, 1000)).rejects.toThrow(
      "Database migrations did not reach the required runtime state",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await readiness;
    vi.useRealTimers();
  });
});
