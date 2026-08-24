import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const createFakeClient = () => {
  const pending: PromiseWithResolvers<unknown[]>[] = [];
  const client = {
    unsafe: (): object => {
      const deferred = Promise.withResolvers<unknown[]>();
      pending.push(deferred);
      return deferred.promise;
    },
  };
  return { client, pending };
};

describe("database pool telemetry", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts queries and their wall time within a window", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const first = (client.unsafe() as PromiseLike<unknown>).then((result) => result);
      const second = (client.unsafe() as PromiseLike<unknown>).then((result) => result);

      expect(readWindow().inFlight).toBe(2);
      expect(readWindow().queryCount).toBe(2);

      pending[0]?.resolve([]);
      pending[1]?.resolve([]);
      await first;
      await second;

      const sample = readWindow();
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(2);
      expect(sample.queryDurationMs).toBeGreaterThanOrEqual(0);
      expect(sample.failedQueryCount).toBe(0);
      expect(sample.queuedQueryCount).toBe(0);
    });
  });

  it("counts a query issued beyond the pool maximum as queued", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const queries = ([client.unsafe(), client.unsafe(), client.unsafe()] as PromiseLike<unknown>[])
        .map((query) => query.then((result) => result));

      expect(readWindow().queuedQueryCount).toBe(1);

      for (const deferred of pending) {
        deferred.resolve([]);
      }
      await Promise.all(queries);

      expect(readWindow().queuedQueryCount).toBe(1);
      expect(readWindow().inFlight).toBe(0);
    });
  });

  it("releases in-flight and records a failure when a query rejects", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      const query = client.unsafe() as PromiseLike<unknown>;
      pending[0]?.reject(new Error("connection closed"));
      await expect(Promise.resolve(query)).rejects.toThrow("connection closed");

      const sample = readWindow();
      expect(sample.inFlight).toBe(0);
      expect(sample.failedQueryCount).toBe(1);
      expect(sample.queryCount).toBe(1);
    });
  });

  it("scopes counts to the window that was open", async () => {
    const { client, pending } = createFakeClient();
    instrumentDatabasePool(client, 2);

    const before = client.unsafe() as PromiseLike<unknown>;
    pending[0]?.resolve([]);
    await before;

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      expect(readWindow().queryCount).toBe(0);

      const during = client.unsafe() as PromiseLike<unknown>;
      pending[1]?.resolve([]);
      await during;

      expect(readWindow().queryCount).toBe(1);
    });
  });
});

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry against a real pool", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("observes drizzle selects and transactions without changing their results", async () => {
    const sql = new SQL({ max: 3, prepare: false, url: TEST_DATABASE_URL });
    try {
      instrumentDatabasePool(
        sql as unknown as Parameters<typeof instrumentDatabasePool>[0],
        3,
      );
      const database = drizzle({ client: sql });

      await withDatabasePoolWindow(async (readWindow): Promise<void> => {
        const rows = await database.execute("select 1 as one");
        expect([...rows]).toEqual([{ one: 1 }]);

        await database.transaction(async (transaction) => {
          await transaction.execute("select 2 as two");
          await transaction.execute("select 3 as three");
        });

        const sample = readWindow();
        expect(sample.queryCount).toBeGreaterThanOrEqual(3);
        expect(sample.inFlight).toBe(0);
        expect(sample.failedQueryCount).toBe(0);
        expect(sample.queryDurationMs).toBeGreaterThan(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("reports queued queries when concurrent demand exceeds the pool maximum", async () => {
    const sql = new SQL({ max: 2, prepare: false, url: TEST_DATABASE_URL });
    try {
      instrumentDatabasePool(
        sql as unknown as Parameters<typeof instrumentDatabasePool>[0],
        2,
      );
      const database = drizzle({ client: sql });

      await withDatabasePoolWindow(async (readWindow): Promise<void> => {
        await Promise.all(
          Array.from({ length: 6 }, () => database.execute("select pg_sleep(0.05)")),
        );

        const sample = readWindow();
        expect(sample.queryCount).toBe(6);
        expect(sample.queuedQueryCount).toBeGreaterThan(0);
        expect(sample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });
});
