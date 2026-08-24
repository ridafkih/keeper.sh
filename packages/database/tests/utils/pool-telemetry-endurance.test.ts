import { describe, expect, it } from "vitest";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const POOL_MAX = 4;

interface PoolClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: PoolClient) => Promise<unknown>) => Promise<unknown>;
  savepoint: (callback: (transactionClient: PoolClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const run = async (client: PoolClient, query: string): Promise<unknown> =>
  await (client.unsafe(query, []) as Promise<unknown>);

const swallow = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    return await work();
  } catch (error) {
    return error;
  }
};

const probeIdlePool = async (client: PoolClient) =>
  await withDatabasePoolWindow(async (readWindow) => {
    await run(client, "select 1");
    return readWindow();
  });

const withPool = async (body: (client: PoolClient) => Promise<void>): Promise<void> => {
  resetDatabasePoolTelemetry();
  const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
  try {
    await sql`select 1`;
    const client = sql as unknown as PoolClient;
    instrumentDatabasePool(client, POOL_MAX);
    await body(client);
  } finally {
    await sql.end();
  }
};

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry endurance", () => {
  it("converges over many rounds of mixed success, failure, nesting and concurrency", async () => {
    await withPool(async (client): Promise<void> => {
      const residues: string[] = [];

      for (let round = 0; round < 25; round++) {
        await client.begin(async (transaction) => {
          await run(transaction, "select 1");
          await transaction.savepoint(async (savepoint) => {
            await run(savepoint, "select 2");
          });
        });

        await swallow(async () => await client.begin(async (transaction) => {
          await run(transaction, "select 1");
          throw new Error("body failed");
        }));

        await swallow(async () => await client.begin(async (transaction) => {
          await run(transaction, "select 1 / 0");
        }));

        await swallow(async () => await client.begin(async (transaction) => {
          await swallow(async () => await transaction.savepoint(async (savepoint) => {
            await run(savepoint, "select 1 / 0");
          }));
          await run(transaction, "select 3");
        }));

        await Promise.all(Array.from({ length: POOL_MAX * 3 }, () =>
          client.begin(async (transaction) => {
            await run(transaction, "select 4");
          })));

        await swallow(async () => await run(client, "selec bad syntax"));

        const sample = await probeIdlePool(client);
        residues.push(JSON.stringify({
          failed: sample.failedQueryCount,
          inFlight: sample.inFlight,
          queries: sample.queryCount,
          queued: sample.queuedQueryCount,
        }));
      }

      expect(new Set(residues).size).toBe(1);
      expect(residues[0]).toBe(JSON.stringify({ failed: 0, inFlight: 0, queries: 1, queued: 0 }));
    });
  });

  it("converges when the server kills the connection under an open transaction", async () => {
    await withPool(async (client): Promise<void> => {
      for (let round = 0; round < 5; round++) {
        await swallow(async () => await client.begin(async (transaction) => {
          await run(transaction, "select 1");
          await run(transaction, "select pg_terminate_backend(pg_backend_pid())");
        }));

        const sample = await probeIdlePool(client);
        expect(sample).toMatchObject({
          failedQueryCount: 0,
          inFlight: 0,
          queryCount: 1,
          queuedQueryCount: 0,
        });
      }
    });
  });

  it("converges when a statement is cancelled by statement_timeout", async () => {
    await withPool(async (client): Promise<void> => {
      for (let round = 0; round < 3; round++) {
        await swallow(async () => await client.begin(async (transaction) => {
          await run(transaction, "set local statement_timeout = 50");
          await run(transaction, "select pg_sleep(2)");
        }));

        const sample = await probeIdlePool(client);
        expect(sample).toMatchObject({
          failedQueryCount: 0,
          inFlight: 0,
          queryCount: 1,
          queuedQueryCount: 0,
        });
      }
    });
  });

  it("keeps a saturating workload from ratcheting the queued verdict", async () => {
    await withPool(async (client): Promise<void> => {
      const queuedCounts: number[] = [];

      for (let round = 0; round < 6; round++) {
        await withDatabasePoolWindow(async (readWindow): Promise<void> => {
          await Promise.all(Array.from({ length: POOL_MAX * 2 }, () =>
            client.begin(async (transaction) => {
              await run(transaction, "select pg_sleep(0.02)");
            })));
          queuedCounts.push(readWindow().queuedQueryCount);
        });
      }

      expect(new Set(queuedCounts).size).toBe(1);
      expect(queuedCounts[0]).toBe(POOL_MAX);
    });
  });
});
