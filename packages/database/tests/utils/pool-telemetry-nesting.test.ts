import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

interface FakeClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

// Bun hands `begin` a fresh client and `savepoint` the one it was called on.
const createFakeClient = () => {
  const executed: string[] = [];

  const buildClient = (): FakeClient => {
    const client: FakeClient = {
      begin: async (callback: (transactionClient: FakeClient) => Promise<unknown>) =>
        await callback(buildClient()),
      savepoint: async function savepoint(
        this: FakeClient,
        callback: (savepointClient: FakeClient) => Promise<unknown>,
      ) {
        return await callback(client);
      },
      unsafe: (query: string): object => {
        executed.push(query);
        return Promise.resolve([]);
      },
    };
    return client;
  };

  return { client: buildClient(), executed };
};

describe("database pool telemetry under nested transactions", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts a query inside a savepoint exactly once", async () => {
    const { client, executed } = createFakeClient();
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await client.begin(async (transaction: FakeClient) => {
        await transaction.unsafe("select 1");
        await (transaction.savepoint as (
          callback: (savepointClient: FakeClient) => Promise<unknown>,
        ) => Promise<unknown>)(async (savepoint) => {
          await savepoint.unsafe("select 2");
        });
        await transaction.unsafe("select 3");
      });

      expect(executed).toEqual(["select 1", "select 2", "select 3"]);
      expect(readWindow().queryCount).toBe(executed.length);
      expect(readWindow().inFlight).toBe(0);
    });
  });

  it("does not multiply counts as savepoints nest", async () => {
    const { client, executed } = createFakeClient();
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await client.begin(async (transaction: FakeClient) => {
        const savepoint = transaction.savepoint as (
          callback: (savepointClient: FakeClient) => Promise<unknown>,
        ) => Promise<unknown>;
        await savepoint(async (first) => {
          await first.unsafe("select 1");
          await (first.savepoint as typeof savepoint)(async (second) => {
            await second.unsafe("select 2");
            await (second.savepoint as typeof savepoint)(async (third) => {
              await third.unsafe("select 3");
            });
          });
        });
      });

      expect(executed).toHaveLength(3);
      expect(readWindow().queryCount).toBe(3);
    });
  });

  it("does not report queued queries when only one query is ever in flight", async () => {
    const { client } = createFakeClient();
    instrumentDatabasePool(client, 4);

    await withDatabasePoolWindow(async (readWindow): Promise<void> => {
      await client.begin(async (transaction: FakeClient) => {
        const savepoint = transaction.savepoint as (
          callback: (savepointClient: FakeClient) => Promise<unknown>,
        ) => Promise<unknown>;
        for (let depth = 0; depth < 4; depth++) {
          await savepoint(async (savepointClient) => {
            await savepointClient.unsafe("select 1");
          });
        }
      });

      expect(readWindow().queuedQueryCount).toBe(0);
      expect(readWindow().inFlight).toBe(0);
    });
  });

  it("reports the same counts for every repetition of an identical transaction", async () => {
    const { client } = createFakeClient();
    instrumentDatabasePool(client, 10);

    const counts: number[] = [];
    for (let round = 0; round < 4; round++) {
      await withDatabasePoolWindow(async (readWindow): Promise<void> => {
        await client.begin(async (transaction: FakeClient) => {
          await transaction.unsafe("select 1");
          await (transaction.savepoint as (
            callback: (savepointClient: FakeClient) => Promise<unknown>,
          ) => Promise<unknown>)(async (savepoint) => {
            await savepoint.unsafe("select 2");
          });
        });
        counts.push(readWindow().queryCount);
      });
    }

    expect(counts).toEqual([2, 2, 2, 2]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry against a real nested transaction", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts each statement of a drizzle nested transaction once", async () => {
    const sql = new SQL({ max: 3, prepare: false, url: TEST_DATABASE_URL });
    try {
      instrumentDatabasePool(sql as unknown as Parameters<typeof instrumentDatabasePool>[0], 3);
      const database = drizzle({ client: sql });

      await withDatabasePoolWindow(async (readWindow): Promise<void> => {
        await database.transaction(async (transaction) => {
          await transaction.execute("select 1 as one");
          await transaction.transaction(async (nested) => {
            await nested.execute("select 2 as two");
          });
          await transaction.execute("select 3 as three");
        });

        const sample = readWindow();
        expect(sample.queryCount).toBe(3);
        expect(sample.queuedQueryCount).toBe(0);
        expect(sample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("settles a query consumed through catch", async () => {
    const sql = new SQL({ max: 3, prepare: false, url: TEST_DATABASE_URL });
    try {
      instrumentDatabasePool(sql as unknown as Parameters<typeof instrumentDatabasePool>[0], 3);
      const client = sql as unknown as { unsafe: (query: string, params?: unknown[]) => object };

      await withDatabasePoolWindow(async (readWindow): Promise<void> => {
        await (client.unsafe("select 1", []) as Promise<unknown>).catch(() => null);
        await (client.unsafe("selec bad", []) as Promise<unknown>).catch(() => null);

        const sample = readWindow();
        expect(sample.queryCount).toBe(2);
        expect(sample.inFlight).toBe(0);
        expect(sample.failedQueryCount).toBe(1);
      });
    } finally {
      await sql.end();
    }
  });

  it("keeps in-flight at zero across repeated failing transactions", async () => {
    const sql = new SQL({ max: 3, prepare: false, url: TEST_DATABASE_URL });
    try {
      instrumentDatabasePool(sql as unknown as Parameters<typeof instrumentDatabasePool>[0], 3);
      const database = drizzle({ client: sql });

      const samples: number[] = [];
      for (let round = 0; round < 3; round++) {
        await withDatabasePoolWindow(async (readWindow): Promise<void> => {
          await expect(database.transaction(async (transaction) => {
            await transaction.execute("select 1 as one");
            throw new Error("rolled back");
          })).rejects.toThrow("rolled back");
          samples.push(readWindow().inFlight);
        });
      }

      expect(samples).toEqual([0, 0, 0]);
    } finally {
      await sql.end();
    }
  });
});
