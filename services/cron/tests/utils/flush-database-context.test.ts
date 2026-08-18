import { describe, expect, it, vi } from "vitest";

/*
 * The flush writer must persist through a dedicated single-connection database
 * so that high fetch concurrency can never open concurrent write transactions
 * against Postgres. This pins that the cron context constructs a second
 * database instance with { maxConnections: 1 } and that shutting the context
 * down closes both instances.
 */

const TEST_DATABASE_URL = "postgres://cron-test/keeper";

const mocks = vi.hoisted(() => {
  const pooledInstance = { name: "pooled-database" };
  const flushInstance = { name: "flush-database" };
  const instances = [pooledInstance, flushInstance];
  let callIndex = 0;
  const createDatabase = vi.fn(() => {
    const instance = instances[callIndex] ?? { name: "unexpected-extra-database" };
    callIndex += 1;
    return Promise.resolve(instance);
  });
  const closeDatabase = vi.fn();
  return { closeDatabase, createDatabase, flushInstance, pooledInstance };
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

describe("cron context flush database", () => {
  it("creates a dedicated single-connection flush database alongside the pooled one", async () => {
    const context = await import("../../src/context");

    expect(mocks.createDatabase).toHaveBeenCalledTimes(2);
    expect(mocks.createDatabase).toHaveBeenNthCalledWith(1, TEST_DATABASE_URL, {
      maxConnections: 10,
    });
    expect(mocks.createDatabase).toHaveBeenNthCalledWith(2, TEST_DATABASE_URL, {
      maxConnections: 1,
    });

    const exported = context as Record<string, unknown>;
    expect(exported.database).toBe(mocks.pooledInstance);
    expect(exported.flushDatabase).toBe(mocks.flushInstance);
  });

  it("closes both database instances on context shutdown", async () => {
    const context = await import("../../src/context");
    const exported = context as Record<string, unknown>;
    const { shutdownDatabases } = exported;

    expect(typeof shutdownDatabases).toBe("function");
    await (shutdownDatabases as () => Promise<void> | void)();

    expect(mocks.closeDatabase).toHaveBeenCalledWith(mocks.pooledInstance);
    expect(mocks.closeDatabase).toHaveBeenCalledWith(mocks.flushInstance);
  });
});
