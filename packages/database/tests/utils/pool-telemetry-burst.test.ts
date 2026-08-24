import { beforeEach, describe, expect, it } from "vitest";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";
import { holdConnections, type PoolClient } from "./support/pool-barrier";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const POOL_MAX = 2;

const openTransaction = (client: PoolClient): Promise<unknown> =>
  client.begin(async (transactionClient) => {
    await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
  });

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry under a burst of transactions", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("counts every transaction issued against a fully held pool as queued", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const occupants = await holdConnections(client, POOL_MAX);

      await withDatabasePoolWindow(async (window): Promise<void> => {
        const burst = Array.from({ length: 6 }, () => openTransaction(client));
        await occupants.release();
        await Promise.all(burst);
        const sample = window();

        expect(sample.queryCount).toBe(6);
        expect(sample.queuedQueryCount).toBe(6);
        expect(sample.inFlight).toBe(0);
        expect(sample.failedQueryCount).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("keeps the queued verdict the same whether the same work is issued at once or one at a time", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const atOnceOccupants = await holdConnections(client, POOL_MAX);
      const atOnce = await withDatabasePoolWindow(async (window) => {
        const burst = Array.from({ length: 6 }, () => openTransaction(client));
        await atOnceOccupants.release();
        await Promise.all(burst);
        return window();
      });

      const staggeredOccupants = await holdConnections(client, POOL_MAX);
      const staggered = await withDatabasePoolWindow(async (window) => {
        const issued: Promise<unknown>[] = [];
        for (let index = 0; index < 6; index += 1) {
          issued.push(openTransaction(client));
          await Promise.resolve();
        }
        await staggeredOccupants.release();
        await Promise.all(issued);
        return window();
      });

      expect(staggered.queuedQueryCount).toBe(atOnce.queuedQueryCount);
      expect(staggered.queryCount).toBe(atOnce.queryCount);
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
        const occupants = await holdConnections(client, POOL_MAX);
        await withDatabasePoolWindow(async (window): Promise<void> => {
          const burst = Array.from({ length: 4 }, () => openTransaction(client));
          await occupants.release();
          await Promise.all(burst);
          const sample = window();
          expect(sample.queryCount).toBe(4);
          expect(sample.inFlight).toBe(0);
          expect(sample.failedQueryCount).toBe(0);
          rounds.push(sample.queuedQueryCount);
        });
      }

      expect(rounds).toEqual([4, 4, 4]);

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
