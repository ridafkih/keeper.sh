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

interface AttemptResult {
  queuedQueryCount: number;
  queryCount: number;
  startOffsetMs: number;
  waited: boolean;
}

const runAttempt = async (client: PoolClient): Promise<AttemptResult> =>
  await withDatabasePoolWindow(async (window) => {
    const issuedAt = performance.now();
    let startOffsetMs = 0;
    await client.begin(async (transactionClient) => {
      startOffsetMs = performance.now() - issuedAt;
      await (transactionClient.unsafe(`select pg_sleep(${STATEMENT_SECONDS})`, []) as Promise<unknown>);
    });
    const sample = window();
    return {
      queryCount: sample.queryCount,
      queuedQueryCount: sample.queuedQueryCount,
      startOffsetMs,
      waited: startOffsetMs > STATEMENT_SECONDS * 500,
    };
  });

describe.skipIf(!TEST_DATABASE_URL)("database pool queue attribution across attempts", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("charges the queued verdict to the attempts that actually waited", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const attempts = await Promise.all(
        Array.from({ length: 4 }, () => runAttempt(client)),
      );

      for (const attempt of attempts) {
        expect(attempt.queryCount).toBe(1);
        expect(attempt.queuedQueryCount).toBeLessThanOrEqual(1);
      }

      const waited = attempts.filter((attempt) => attempt.waited);
      const flagged = attempts.filter((attempt) => attempt.queuedQueryCount === 1);
      expect(
        waited.length,
        `start offsets: ${attempts.map((attempt) => Math.round(attempt.startOffsetMs)).join(",")}`,
      ).toBe(2);
      expect(flagged.length).toBe(waited.length);
      for (const attempt of attempts) {
        expect(
          attempt.queuedQueryCount === 1,
          `offset ${Math.round(attempt.startOffsetMs)}ms flagged ${attempt.queuedQueryCount}`,
        ).toBe(attempt.waited);
      }
    } finally {
      await sql.end();
    }
  });

  it("converges: repeated bursts flag the same number of attempts and leave no residue", async () => {
    const sql = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, POOL_MAX);

      const flaggedPerRound: number[] = [];
      for (let round = 0; round < 3; round++) {
        const attempts = await Promise.all(
          Array.from({ length: 4 }, () => runAttempt(client)),
        );
        flaggedPerRound.push(
          attempts.filter((attempt) => attempt.queuedQueryCount === 1).length,
        );
      }

      expect(
        new Set(flaggedPerRound).size,
        `flagged per round: ${flaggedPerRound.join(",")}`,
      ).toBe(1);
      expect(flaggedPerRound[0]).toBe(2);

      const solitary = await runAttempt(client);
      expect(solitary.queuedQueryCount).toBe(0);
      expect(solitary.waited).toBe(false);
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

      await Promise.all(Array.from({ length: 8 }, () => runAttempt(client)));

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
