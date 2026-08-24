import { describe, expect, it, vi } from "vitest";

interface InFlightDrainRegistryStub {
  register: (work: Promise<unknown>) => void;
  settle: () => Promise<void>;
}

interface HarnessState {
  cleanup: (() => Promise<void>) | null;
  events: string[];
  registry: InFlightDrainRegistryStub;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const SHUTDOWN_TEST_TIMEOUT_MS = 10_000;

const createDeferred = (): Deferred => {
  let settle: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (): void => {
      settle?.();
    },
  };
};

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const harness = vi.hoisted((): HarnessState => {
  const events: string[] = [];
  const tracked: Promise<unknown>[] = [];
  return {
    cleanup: null,
    events,
    registry: {
      register: (work: Promise<unknown>): void => {
        tracked.push(work);
      },
      settle: async (): Promise<void> => {
        await Promise.all(tracked.map((work) => work.catch(() => null)));
      },
    },
  };
});

vi.mock("entrykit", () => ({
  entry: async (options: { main: () => Promise<() => Promise<void>> }): Promise<void> => {
    harness.cleanup = await options.main();
  },
}));

vi.mock("../src/env", () => ({
  default: { WORKER_JOB_QUEUE_ENABLED: true },
}));

vi.mock("../src/migration-check", () => ({
  checkWorkerMigrationStatus: (): null => null,
}));

vi.mock("../src/context", () => ({
  database: { name: "fake-database" },
  inFlightDrainRegistry: harness.registry,
  refreshLockRedis: { hmget: (): Promise<null[]> => Promise.resolve([]) },
  shutdownDatabases: (): Promise<void> => Promise.resolve(),
  shutdownRefreshLockRedis: (): void => {
    harness.events.push("redis-torn-down");
  },
  shutdownSignalReaderRedis: (): null => null,
  signalReaderRedis: {
    blpop: (): Promise<null> => Promise.resolve(null),
    disconnect: (): null => null,
  },
}));

vi.mock("@keeper.sh/database", () => ({
  createMigrationReadinessDatabase: (): object => ({}),
  waitForDatabaseMigrations: (): Promise<void> => Promise.resolve(),
}));

vi.mock("../src/utils/logging", () => ({
  destroy: (): null => null,
}));

vi.mock("../src/utils/get-jobs", () => ({
  getAllJobs: (): Promise<unknown[]> => Promise.resolve([]),
}));

describe("SIGTERM cleanup and an in-flight drain tick", () => {
  it("tears down refreshLockRedis only after the in-flight drain has finished", async () => {
    await import("../src/index");
    expect(harness.cleanup).not.toBeNull();

    const drainTick = createDeferred();
    harness.registry.register(drainTick.promise.then(() => {
      harness.events.push("drain-finished");
      return null;
    }));

    const shutdown = harness.cleanup?.();
    await flushMicrotasks();

    expect(harness.events).toEqual([] as string[]);

    drainTick.resolve();
    await shutdown;

    expect(harness.events).toEqual(["drain-finished", "redis-torn-down"]);
  });

  it("still completes shutdown when a wedged drain never settles", async () => {
    expect(harness.cleanup).not.toBeNull();

    const wedgedDrain = createDeferred();
    harness.registry.register(wedgedDrain.promise);

    const teardownsBefore = harness.events.filter((event) => event === "redis-torn-down").length;
    await harness.cleanup?.();

    const teardownsAfter = harness.events.filter((event) => event === "redis-torn-down").length;
    expect(teardownsAfter).toBe(teardownsBefore + 1);
  }, SHUTDOWN_TEST_TIMEOUT_MS);
});
