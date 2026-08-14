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

interface AttemptResult {
  queuedQueryCount: number;
  queryCount: number;
}

const runAttempt = async (client: PoolClient): Promise<AttemptResult> =>
  await withDatabasePoolWindow(async (window) => {
    await client.begin(async (transactionClient) => {
      await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
    });
    const sample = window();
    return { queryCount: sample.queryCount, queuedQueryCount: sample.queuedQueryCount };
  });

/*
 * Every connection is held before a single waiter is issued, so which attempts queued is
 * known by construction and never inferred from how long anything took.
 */
const runContendedRound = async (
  client: PoolClient,
  waiterCount: number,
): Promise<AttemptResult[]> => {
  const occupants = await holdConnections(client, POOL_MAX);
  const waiters = Array.from({ length: waiterCount }, () => runAttempt(client));
  await occupants.release();
  return await Promise.all(waiters);
};

describe.skipIf(!TEST_DATABASE_URL)("database pool queue attribution across attempts", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("charges the queued verdict to the attempts that waited and to no others", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const waited = await runContendedRound(client, 2);
      for (const attempt of waited) {
        expect(attempt.queryCount).toBe(1);
        expect(attempt.queuedQueryCount).toBe(1);
      }

      const unqueued = await Promise.all([runAttempt(client), runAttempt(client)]);
      for (const attempt of unqueued) {
        expect(attempt.queryCount).toBe(1);
        expect(attempt.queuedQueryCount).toBe(0);
      }
    } finally {
      await sql.end();
    }
  });

  it("charges a waiting transaction exactly once however many statements it runs", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const occupants = await holdConnections(client, POOL_MAX);
      const waiter = withDatabasePoolWindow(async (window) => {
        await client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
          await (transactionClient.unsafe("select 2", []) as Promise<unknown>);
          await (transactionClient.unsafe("select 3", []) as Promise<unknown>);
        });
        return window();
      });
      await occupants.release();

      const sample = await waiter;
      expect(sample.queryCount).toBe(3);
      expect(sample.queuedQueryCount).toBe(1);
      expect(sample.inFlight).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("converges: repeated contended rounds flag the same attempts and leave no residue", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const flaggedPerRound: number[] = [];
      for (let round = 0; round < 3; round++) {
        const attempts = await runContendedRound(client, 4);
        flaggedPerRound.push(
          attempts.filter((attempt) => attempt.queuedQueryCount === 1).length,
        );
      }

      expect(flaggedPerRound).toEqual([4, 4, 4]);

      const solitary = await runAttempt(client);
      expect(solitary.queuedQueryCount).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("does not leave an idle pool reporting demand after a saturating burst", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      await runContendedRound(client, 8);

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
