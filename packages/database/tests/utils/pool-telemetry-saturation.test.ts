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

const holdConnections = async (
  client: PoolClient,
  count: number,
): Promise<{ release: () => Promise<void> }> => {
  const releases: (() => void)[] = [];
  const held = Array.from({ length: count }, (_unused, index) =>
    client.begin(async (transactionClient) => {
      await (transactionClient.unsafe(`select ${index}`, []) as Promise<unknown>);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    }));
  while (releases.length < count) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  return {
    release: async () => {
      for (const release of releases) {
        release();
      }
      await Promise.all(held);
    },
  };
};

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry under saturation", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("charges a transaction's wait for a connection to its first statement", async () => {
    const sql = new SQL({ max: 2, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, 2);
      const occupants = await holdConnections(client, 2);

      await withDatabasePoolWindow(async (window): Promise<void> => {
        const blocked = client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("select 98", []) as Promise<unknown>);
          await (transactionClient.unsafe("select 99", []) as Promise<unknown>);
        });
        await new Promise((resolve) => {
          setTimeout(resolve, 200);
        });
        expect(window().queryCount).toBe(0);

        await occupants.release();
        await blocked;

        const sample = window();
        expect(sample.queryCount).toBe(2);
        expect(sample.queuedQueryCount).toBe(1);
        expect(sample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("stops reporting queued once the transactions release their connections", async () => {
    const sql = new SQL({ max: 2, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, 2);

      const occupants = await holdConnections(client, 2);
      await occupants.release();

      await withDatabasePoolWindow(async (window): Promise<void> => {
        await (client.unsafe("select 1", []) as Promise<unknown>);
        await client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("select 2", []) as Promise<unknown>);
        });

        const sample = window();
        expect(sample.queryCount).toBe(2);
        expect(sample.queuedQueryCount).toBe(0);
        expect(sample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });

  it("counts a saturated transaction's wait once however many statements follow", async () => {
    const sql = new SQL({ max: 2, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql`select 1`;
      const client = sql as unknown as PoolClient;
      instrumentDatabasePool(client, 2);
      const occupants = await holdConnections(client, 2);

      await withDatabasePoolWindow(async (window): Promise<void> => {
        const blocked = client.begin(async (transactionClient) => {
          const savepoint = transactionClient.savepoint as (
            callback: (savepointClient: PoolClient) => Promise<unknown>,
          ) => Promise<unknown>;
          await savepoint(async (savepointClient) => {
            await (savepointClient.unsafe("select 1", []) as Promise<unknown>);
          });
          await (transactionClient.unsafe("select 2", []) as Promise<unknown>);
          await (transactionClient.unsafe("select 3", []) as Promise<unknown>);
        });
        await new Promise((resolve) => {
          setTimeout(resolve, 200);
        });
        await occupants.release();
        await blocked;

        const sample = window();
        expect(sample.queryCount).toBe(3);
        expect(sample.queuedQueryCount).toBe(1);
        expect(sample.inFlight).toBe(0);
      });
    } finally {
      await sql.end();
    }
  });
});
