import { beforeEach, describe, expect, it } from "vitest";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

interface PoolClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: PoolClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

const POOL_MAX = 2;
const STATEMENT_SECONDS = 0.1;

const runBurst = async (
  client: PoolClient,
  transactionCount: number,
): Promise<{ startOffsetsMs: number[]; wallMs: number }> => {
  const startedAt = performance.now();
  const startOffsetsMs: number[] = [];
  await Promise.all(Array.from({ length: transactionCount }, () =>
    client.begin(async (transactionClient) => {
      startOffsetsMs.push(performance.now() - startedAt);
      await (transactionClient.unsafe(`select pg_sleep(${STATEMENT_SECONDS})`, []) as Promise<unknown>);
    })));
  return { startOffsetsMs, wallMs: performance.now() - startedAt };
};

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry under a burst of transactions", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts transactions that demonstrably waited for a connection as queued", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      await withDatabasePoolWindow(async (window): Promise<void> => {
        const burst = await runBurst(client, 6);
        const sample = window();

        const waited = burst.startOffsetsMs.filter((offset) => offset > STATEMENT_SECONDS * 500);

        expect(waited.length).toBe(4);
        expect(burst.wallMs).toBeGreaterThan(STATEMENT_SECONDS * 1000 * 2);
        expect(sample.queryCount).toBe(6);
        expect(sample.queuedQueryCount).toBeGreaterThanOrEqual(waited.length);
      });
    } finally {
      await sql.end();
    }
  });

  it("keeps the queued verdict the same whether the same work is issued at once or staggered", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      await withDatabasePoolWindow(async (burstWindow): Promise<void> => {
        await runBurst(client, 6);
        const burstSample = burstWindow();

        await withDatabasePoolWindow(async (staggeredWindow): Promise<void> => {
          const staggered: Promise<unknown>[] = [];
          for (let index = 0; index < 6; index += 1) {
            staggered.push(client.begin(async (transactionClient) => {
              await (transactionClient.unsafe(`select pg_sleep(${STATEMENT_SECONDS})`, []) as Promise<unknown>);
            }));
            await new Promise((resolve) => {
              setTimeout(resolve, 5);
            });
          }
          await Promise.all(staggered);
          const staggeredSample = staggeredWindow();

          expect(staggeredSample.queuedQueryCount).toBeGreaterThan(0);
          expect(burstSample.queuedQueryCount).toBe(staggeredSample.queuedQueryCount);
        });
      });
    } finally {
      await sql.end();
    }
  });

  it("converges: repeated bursts report identical counts and leave the pool unqueued", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const rounds: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        await withDatabasePoolWindow(async (window): Promise<void> => {
          await runBurst(client, 4);
          const sample = window();
          expect(sample.queryCount).toBe(4);
          expect(sample.inFlight).toBe(0);
          expect(sample.failedQueryCount).toBe(0);
          rounds.push(sample.queuedQueryCount);
        });
      }

      expect(new Set(rounds).size).toBe(1);

      await withDatabasePoolWindow(async (idleWindow): Promise<void> => {
        await (client.unsafe("select 1", []) as Promise<unknown>);
        const idleSample = idleWindow();

        expect(idleSample.queryCount).toBe(1);
        expect(idleSample.queuedQueryCount).toBe(0);
        expect(idleSample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("does not leak held connections when transactions reject or roll back", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      for (let round = 0; round < 6; round += 1) {
        await expect(client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
          throw new Error(`rolled back ${round}`);
        })).rejects.toThrow(`rolled back ${round}`);

        await expect(client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("selec bad", []) as Promise<unknown>);
        })).rejects.toBeDefined();
      }

      await withDatabasePoolWindow(async (window): Promise<void> => {
        await (client.unsafe("select 1", []) as Promise<unknown>);
        const sample = window();

        expect(sample.queryCount).toBe(1);
        expect(sample.queuedQueryCount).toBe(0);
        expect(sample.inFlight).toBe(0);
        expect(sample.failedQueryCount).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });
});
