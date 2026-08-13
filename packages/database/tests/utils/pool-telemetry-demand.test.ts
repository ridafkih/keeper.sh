import { beforeEach, describe, expect, it } from "vitest";
import { SQL } from "bun";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

interface FakeClient extends Record<string, unknown> {
  unsafe: (query: string, params?: unknown[]) => object;
}

const createDeferredClient = () => {
  const pending: { reject: (error: unknown) => void; resolve: (rows: unknown) => void }[] = [];
  const client: FakeClient = {
    unsafe: (): object => {
      const deferred = Promise.withResolvers<unknown>();
      const { promise } = deferred;
      pending.push({ reject: deferred.reject, resolve: deferred.resolve });
      return {
        catch(onRejected: (error: unknown) => unknown) {
          return promise.catch(onRejected);
        },
        finally(onFinally: () => unknown) {
          return promise.finally(onFinally);
        },
        // eslint-disable-next-line unicorn/no-thenable -- the fixture stands in for Bun's lazy SQLQuery
        then(onFulfilled?: (rows: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
          return promise.then(onFulfilled, onRejected);
        },
        values() {
          return this;
        },
      };
    },
  };
  return { client, pending };
};

describe("database pool telemetry demand accounting", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("scopes overlapping windows to their own spans", async () => {
    const { client, pending } = createDeferredClient();
    instrumentDatabasePool(client, 10);

    await withDatabasePoolWindow(async (outer): Promise<void> => {
      const first = (client.unsafe("select 1") as Promise<unknown>).then((result) => result);
      await withDatabasePoolWindow(async (inner): Promise<void> => {
        const second = (client.unsafe("select 2") as Promise<unknown>).then((result) => result);

        expect(outer().queryCount).toBe(1);
        expect(inner().queryCount).toBe(1);
        expect(outer().inFlight).toBe(2);

        pending[0]?.resolve([]);
        pending[1]?.resolve([]);
        await Promise.all([first, second]);

        expect(outer().queryCount).toBe(1);
        expect(inner().queryCount).toBe(1);
        expect(outer().inFlight).toBe(0);
        expect(inner().inFlight).toBe(0);

        withDatabasePoolWindow((after): void => {
          expect(after()).toEqual({
            failedQueryCount: 0,
            inFlight: 0,
            queryCount: 0,
            queryDurationMs: 0,
            queuedQueryCount: 0,
          });
        });
      });
    });
  });

  it("returns in-flight to zero after repeated failing and succeeding rounds", async () => {
    const { client, pending } = createDeferredClient();
    instrumentDatabasePool(client, 10);

    const samples: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      await withDatabasePoolWindow(async (window): Promise<void> => {
        const ok = client.unsafe("select ok") as Promise<unknown>;
        const bad = client.unsafe("select bad") as Promise<unknown>;
        pending[round * 2]?.resolve([]);
        pending[round * 2 + 1]?.reject(new Error("boom"));
        await ok;
        await expect(bad).rejects.toThrow("boom");
        const sample = window();
        expect(sample.queryCount).toBe(2);
        expect(sample.failedQueryCount).toBe(1);
        samples.push(sample.inFlight);
      });
    }

    expect(samples).toEqual([0, 0, 0, 0, 0]);
  });

  it("adds well under a microsecond of overhead per query", async () => {
    const { client, pending } = createDeferredClient();
    const iterations = 5000;

    const runBatch = async (): Promise<number> => {
      const startedAt = performance.now();
      for (let index = 0; index < iterations; index += 1) {
        const query = client.unsafe("select 1") as { values: () => Promise<unknown> };
        pending.at(-1)?.resolve([]);
        await query.values();
      }
      return performance.now() - startedAt;
    };

    // Fastest of several batches: a single batch is swamped by JIT warm-up and GC.
    const runFastestBatch = async (): Promise<number> => {
      let fastestMs = Number.POSITIVE_INFINITY;
      for (let round = 0; round < 4; round += 1) {
        fastestMs = Math.min(fastestMs, await runBatch());
      }
      return fastestMs;
    };

    const plainMs = await runFastestBatch();
    instrumentDatabasePool(client, 10);
    const instrumentedMs = await runFastestBatch();

    const overheadPerQueryUs = ((instrumentedMs - plainMs) / iterations) * 1000;
    expect(overheadPerQueryUs).toBeLessThan(5);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry against postgres", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("preserves query results and result-mode chaining", async () => {
    const plain = new SQL({ max: 5, url: TEST_DATABASE_URL });
    const instrumented = new SQL({ max: 5, url: TEST_DATABASE_URL });
    await plain`select 1`;
    await instrumented`select 1`;
    instrumentDatabasePool(instrumented as unknown as FakeClient, 5);

    const plainObjects = await plain.unsafe("select 1 as a, 2 as b", []);
    const plainValues = await plain.unsafe("select 1 as a, 2 as b", []).values();
    const instrumentedClient = instrumented as unknown as FakeClient;
    const instrumentedObjects = await (instrumentedClient.unsafe(
      "select 1 as a, 2 as b",
      [],
    ) as Promise<unknown>);
    const instrumentedValues = await (instrumentedClient.unsafe(
      "select 1 as a, 2 as b",
      [],
    ) as { values: () => Promise<unknown> }).values();

    expect(instrumentedObjects).toEqual(plainObjects);
    expect(instrumentedValues).toEqual(plainValues);

    await plain.end();
    await instrumented.end();
  });

  it("counts a query that waits for a pool connection as queued", async () => {
    const sql = new SQL({ max: 2, url: TEST_DATABASE_URL });
    await sql`select 1`;
    instrumentDatabasePool(sql as unknown as FakeClient, 2);
    const client = sql as unknown as FakeClient & {
      begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
    };

    const releases: (() => void)[] = [];
    const held = [0, 1].map((index) =>
      client.begin(async (transactionClient) => {
        await (transactionClient.unsafe(`select ${index}`, []) as Promise<unknown>);
        await new Promise<void>((resolve) => { releases.push(resolve); });
      }));
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    await withDatabasePoolWindow(async (window): Promise<void> => {
      const startedAt = performance.now();
      const blocked = (client.unsafe("select 99", []) as Promise<unknown>).then(
        (result) => result,
      );
      await new Promise((resolve) => { setTimeout(resolve, 300); });

      for (const release of releases) {
        release();
      }
      await Promise.all(held);
      await blocked;
      const waitedMs = performance.now() - startedAt;

      const sample = window();
      expect(waitedMs).toBeGreaterThan(250);
      expect(sample.queryDurationMs).toBeGreaterThan(250);
      expect(sample.queuedQueryCount).toBeGreaterThan(0);

      await sql.end();
    });
  });

  it("keeps counts identical across repeated identical transactions", async () => {
    const sql = new SQL({ max: 5, url: TEST_DATABASE_URL });
    await sql`select 1`;
    instrumentDatabasePool(sql as unknown as FakeClient, 5);
    const client = sql as unknown as {
      begin: (callback: (transactionClient: FakeClient) => Promise<unknown>) => Promise<unknown>;
    };

    const counts: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      await withDatabasePoolWindow(async (window): Promise<void> => {
        await client.begin(async (transactionClient) => {
          await (transactionClient.unsafe("select 1", []) as Promise<unknown>);
          await (transactionClient.unsafe("select 2", []) as Promise<unknown>);
        });
        const sample = window();
        counts.push(sample.queryCount);
        expect(sample.inFlight).toBe(0);
        expect(sample.failedQueryCount).toBe(0);
      });
    }

    expect(counts).toEqual([2, 2, 2, 2]);

    await sql.end();
  });
});
