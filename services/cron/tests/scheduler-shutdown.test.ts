import { afterAll, describe, expect, it, vi } from "vitest";

/*
 * Entrykit registers the cleanup returned by src/index.ts main() via
 * process.once("SIGTERM", cleanup) and never calls process.exit, so the only
 * way the cron service exits gracefully is for cleanup to leave the event
 * loop empty. Cronbake arms bare setTimeout/setInterval timers (never
 * unref'd), so cleanup must stop the baker: otherwise the armed schedulers
 * keep the process alive until the supervisor SIGKILLs it, and jobs whose
 * status is still "running" keep launching full ingest passes against the
 * already-closed flush writer, database pools, and disconnected Redis. This
 * test drives the real registerJobs/baker through index.ts with everything
 * else stubbed, invokes the captured cleanup, and pins that the scheduler is
 * stopped and fires no further ticks afterwards.
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
    // The real check may process.exit(1); the stub keeps the test alive.
  },
}));

vi.mock("../src/context", () => ({
  database: { name: "fake-database" },
  shutdownDatabases: (): Promise<void> => Promise.resolve(),
  shutdownRefreshLockRedis: (): void => {
    // Redis is out of scope here; the stub records nothing.
  },
}));

vi.mock("@keeper.sh/database", () => ({
  createMigrationReadinessDatabase: (): object => ({}),
  waitForDatabaseMigrations: (): Promise<void> => Promise.resolve(),
}));

vi.mock("../src/utils/logging", () => ({
  destroy: (): void => {
    // Logging teardown is out of scope here.
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
    // Disarm any timers the test left behind so the runner can exit.
    const { baker } = await import("../src/utils/baker");
    baker.destroyAll();
  });

  it("stops the scheduler so no new passes launch against torn-down resources", async () => {
    await import("../src/index");
    const { baker } = await import("../src/utils/baker");

    expect(harness.cleanup).not.toBeNull();
    expect(baker.getStatus("shutdown-probe")).toBe("running");

    await harness.cleanup?.();

    /*
     * After cleanup the scheduler must be stopped: a "running" job means
     * armed timers pin the event loop open forever (cronbake never unrefs)
     * and keep firing ingest passes against closed pools.
     */
    expect(baker.getStatus("shutdown-probe")).toBe("stopped");

    const ticksAtCleanup = harness.tickCount;
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    expect(harness.tickCount).toBe(ticksAtCleanup);
  });
});
