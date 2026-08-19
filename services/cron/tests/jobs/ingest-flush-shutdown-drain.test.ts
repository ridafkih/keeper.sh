import { describe, expect, it, vi } from "vitest";

/*
 * The flush writer must be closed and drained before the single-connection
 * flushDatabase it writes through. Closing the database first strands every
 * queued flush, dropping already-fetched payloads on every deploy restart.
 */
const harness = vi.hoisted(() => {
  const events: string[] = [];
  const pooledInstance = { name: "pooled-database" };
  const flushInstance = { name: "flush-database" };
  const instances = [pooledInstance, flushInstance];
  let callIndex = 0;
  const createDatabase = vi.fn(() => {
    const instance = instances[callIndex] ?? { name: "unexpected-extra-database" };
    callIndex += 1;
    return Promise.resolve(instance);
  });
  const closeDatabase = vi.fn((instance: { name: string }) => {
    events.push(`close-db:${instance.name}`);
  });
  interface CapturedWorker {
    close(): Promise<void>;
    reserve(weight: number): Promise<{
      release(): void;
      submit(item: () => Promise<unknown>): Promise<unknown>;
    }>;
  }
  const workers: CapturedWorker[] = [];
  return { closeDatabase, createDatabase, events, flushInstance, pooledInstance, workers };
});

vi.mock("@keeper.sh/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    closeDatabase: harness.closeDatabase,
    createDatabase: harness.createDatabase,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  type WorkerFactory = (...args: unknown[]) => {
    close(): Promise<void>;
    reserve(weight: number): Promise<unknown>;
    submit(item: unknown): Promise<unknown>;
  };
  const actualCreateSerialFlushWorker = actual.createSerialFlushWorker as WorkerFactory;
  return {
    ...actual,
    createSerialFlushWorker: (...args: unknown[]) => {
      const worker = actualCreateSerialFlushWorker(...args);
      const realClose = worker.close.bind(worker);
      worker.close = async (): Promise<void> => {
        harness.events.push("writer-close");
        await realClose();
        harness.events.push("writer-drained");
      };
      harness.workers.push(worker as never);
      return worker;
    },
    resolveWebhookConfig: () => null,
  };
});

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

vi.mock("@polar-sh/sdk", () => ({
  // The member keeps oxlint's no-extraneous-class satisfied on this stub.
  Polar: class FakePolar {
    public readonly mocked = true;
  },
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

vi.mock("../../src/env", () => ({
  default: {
    COMMERCIAL_MODE: false,
    DATABASE_POOL_MAX: 10,
    DATABASE_URL: "postgres://cron-test/keeper",
    REDIS_URL: "redis://cron-test:6379",
  },
}));

vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  destroy: () => null,
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));

vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const yieldToWriterPump = async (): Promise<void> => {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
};

describe("ingest flush writer shutdown drain", () => {
  it("closes and drains the flush writer before closing flushDatabase", async () => {
    await import("../../src/jobs/ingest-sources");
    const { shutdownDatabases } = await import("../../src/context");

    const [worker] = harness.workers;
    expect(worker).toBeDefined();
    if (!worker) {
      return;
    }

    let releaseFlush = (): void => { harness.events.push("flush-release-unwired"); };
    const reservation = await worker.reserve(1024);
    const inFlightFlush = reservation.submit(() => new Promise((resolve) => {
      harness.events.push("flush-started");
      releaseFlush = (): void => {
        harness.events.push("flush-settled");
        resolve("flushed");
      };
    }));

    await yieldToWriterPump();
    expect(harness.events).toContain("flush-started");

    const shutdownResult = (shutdownDatabases as () => Promise<void> | void)();
    releaseFlush();
    await shutdownResult;
    await inFlightFlush;

    const writerCloseIndex = harness.events.indexOf("writer-close");
    const flushDatabaseCloseIndex = harness.events.indexOf("close-db:flush-database");
    expect(flushDatabaseCloseIndex).toBeGreaterThanOrEqual(0);
    expect(writerCloseIndex).toBeGreaterThanOrEqual(0);
    expect(writerCloseIndex).toBeLessThan(flushDatabaseCloseIndex);
    expect(harness.events.indexOf("flush-settled")).toBeLessThan(flushDatabaseCloseIndex);
  });
});
