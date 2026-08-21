import { afterAll, describe, expect, it, vi } from "vitest";

/*
 * Cleanup must stop the baker: cronbake's timers are never unref'd, so a
 * still-"running" job both pins the event loop open and keeps launching
 * ingest passes against closed pools and disconnected Redis.
 */

interface HarnessState {
  cleanup: (() => Promise<void>) | null;
  tickCount: number;
}

const harness = vi.hoisted((): HarnessState => ({
  cleanup: null,
  tickCount: 0,
}));

vi.mock("entrykit", () => ({
  entry: async (options: { main: () => Promise<() => Promise<void>> }): Promise<void> => {
    harness.cleanup = await options.main();
  },
}));

vi.mock("../src/env", () => ({
  default: { WORKER_JOB_QUEUE_ENABLED: true },
}));

vi.mock("../src/migration-check", () => ({
  checkWorkerMigrationStatus: (): void => {
    // The real check may process.exit(1).
  },
}));

vi.mock("../src/context", () => ({
  database: { name: "fake-database" },
  inFlightDrainRegistry: {
    register: (): null => null,
    settle: (): Promise<void> => Promise.resolve(),
  },
  refreshLockRedis: { hmget: (): Promise<null[]> => Promise.resolve([]) },
  shutdownDatabases: (): Promise<void> => Promise.resolve(),
  shutdownRefreshLockRedis: (): void => {
    // Intentionally empty.
  },
  shutdownSignalReaderRedis: (): void => {
    // Intentionally empty.
  },
  signalReaderRedis: {
    blpop: (): Promise<null> => Promise.resolve(null),
    disconnect: (): void => {
      // Intentionally empty.
    },
  },
}));

vi.mock("@keeper.sh/database", () => ({
  createMigrationReadinessDatabase: (): object => ({}),
  waitForDatabaseMigrations: (): Promise<void> => Promise.resolve(),
}));

vi.mock("../src/utils/logging", () => ({
  destroy: (): void => {
    // Intentionally empty.
  },
}));

vi.mock("../src/utils/get-jobs", () => ({
  getAllJobs: (): Promise<unknown[]> =>
    Promise.resolve([
      {
        callback: (): void => {
          harness.tickCount += 1;
        },
        cron: "@every_second",
        name: "shutdown-probe",
      },
    ]),
}));

describe("SIGTERM cleanup and the cronbake scheduler", () => {
  afterAll(async () => {
    const { baker } = await import("../src/utils/baker");
    baker.destroyAll();
  });

  it("stops the scheduler so no new passes launch against torn-down resources", async () => {
    await import("../src/index");
    const { baker } = await import("../src/utils/baker");

    expect(harness.cleanup).not.toBeNull();
    expect(baker.getStatus("shutdown-probe")).toBe("running");

    await harness.cleanup?.();

    expect(baker.getStatus("shutdown-probe")).toBe("stopped");

    const ticksAtCleanup = harness.tickCount;
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    expect(harness.tickCount).toBe(ticksAtCleanup);
  });
});
