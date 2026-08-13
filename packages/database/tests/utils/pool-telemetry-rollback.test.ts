import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/bun-sql";
import { sql as raw } from "drizzle-orm";
import { SQL } from "bun";
import { tmpdir } from "node:os";
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

const createRejectingClient = (invokeCallback: boolean): FakeClient => {
  const buildClient = (): FakeClient => ({
    begin: async (callback: (transactionClient: FakeClient) => Promise<unknown>) => {
      if (invokeCallback) {
        await callback(buildClient());
      }
      throw new Error("pool refused the connection");
    },
    unsafe: (): object => Promise.resolve([]),
  });
  return buildClient();
};

const createHealthyClient = (): FakeClient => {
  const buildClient = (): FakeClient => ({
    begin: async (callback: (transactionClient: FakeClient) => Promise<unknown>) =>
      await callback(buildClient()),
    unsafe: (): object => Promise.resolve([]),
  });
  return buildClient();
};

describe("database pool telemetry after failed acquisitions", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  it("does not ratchet occupancy when the pool never grants the connection", async () => {
    const client = createRejectingClient(false);
    instrumentDatabasePool(client, 2);

    for (let round = 0; round < 50; round++) {
      await expect(client.begin(() => Promise.resolve(null))).rejects.toThrow("pool refused");
    }

    const healthy = createHealthyClient();
    instrumentDatabasePool(healthy, 2);
    await withDatabasePoolWindow(async (window): Promise<void> => {
      await healthy.begin(async (transaction) => {
        await transaction.unsafe("select 1", []);
        return null;
      });

      expect(window()).toEqual({
        failedQueryCount: 0,
        inFlight: 0,
        queryCount: 1,
        queryDurationMs: expect.any(Number),
        queuedQueryCount: 0,
      });
    });
  });

  it("does not ratchet occupancy when the transaction body throws", async () => {
    const client = createHealthyClient();
    instrumentDatabasePool(client, 2);

    for (let round = 0; round < 50; round++) {
      await expect(client.begin(async (transaction) => {
        await transaction.unsafe("select 1", []);
        throw new Error("rolled back");
      })).rejects.toThrow("rolled back");
    }

    await withDatabasePoolWindow(async (window): Promise<void> => {
      await client.begin(async (transaction) => {
        await transaction.unsafe("select 1", []);
        return null;
      });

      const sample = window();
      expect(sample.queuedQueryCount).toBe(0);
      expect(sample.inFlight).toBe(0);
      expect(sample.queryCount).toBe(1);
    });
  });

  it("keeps an unawaited transaction rejection observable to the process", async () => {
    const script = `
      import { instrumentDatabasePool } from ${JSON.stringify(new URL("../../src/utils/pool-telemetry.ts", import.meta.url).pathname)};

      const buildClient = () => ({
        begin: async (callback) => {
          await callback(buildClient());
          throw new Error("boom");
        },
        unsafe: () => Promise.resolve([]),
      });

      const instrument = process.argv[2] === "instrumented";
      const client = buildClient();
      if (instrument) {
        instrumentDatabasePool(client, 2);
      }

      let seen = 0;
      process.on("unhandledRejection", () => { seen += 1; });
      void client.begin(async () => undefined);
      await Bun.sleep(50);
      console.log(String(seen));
    `;
    const scriptPath = `${tmpdir()}/pool-telemetry-unhandled-${process.pid}.probe.ts`;
    await Bun.write(scriptPath, script);

    const run = async (mode: string): Promise<string> => {
      const proc = Bun.spawn(["bun", scriptPath, mode], { stdout: "pipe", stderr: "pipe" });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      return output.trim();
    };

    const baseline = await run("baseline");
    const instrumented = await run("instrumented");

    expect(baseline).toBe("1");
    expect(instrumented).toBe(baseline);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("database pool telemetry across rollback and retry", () => {
  beforeEach(() => {
    resetDatabasePoolTelemetry();
  });

  const withInstrumentedDatabase = async (
    run: (database: ReturnType<typeof drizzle>) => Promise<void>,
  ): Promise<void> => {
    const client = new SQL({ url: TEST_DATABASE_URL as string, max: 10 });
    const database = drizzle({ client });
    instrumentDatabasePool(client as never, 10);
    try {
      await run(database);
    } finally {
      await client.close();
    }
  };

  it("counts a rolled back savepoint exactly once and leaves nothing in flight", async () => {
    await withInstrumentedDatabase(async (database) => {
      const samples: unknown[] = [];

      for (let round = 0; round < 5; round++) {
        await withDatabasePoolWindow(async (window): Promise<void> => {
          await database.transaction(async (transaction) => {
            await transaction.execute(raw`select 1`);
            await expect(transaction.transaction(async (savepoint) => {
              await savepoint.execute(raw`select 2`);
              throw new Error("savepoint rolled back");
            })).rejects.toThrow("savepoint rolled back");
            await transaction.execute(raw`select 3`);
          });
          samples.push(window());
        });
      }

      expect(samples[0]).toEqual({
        failedQueryCount: 0,
        inFlight: 0,
        queryCount: 3,
        queryDurationMs: expect.any(Number),
        queuedQueryCount: 0,
      });
      for (const sample of samples) {
        expect(sample).toMatchObject({
          failedQueryCount: 0,
          inFlight: 0,
          queryCount: 3,
          queuedQueryCount: 0,
        });
      }
    });
  });

  it("converges over repeated mixed rounds of success, rollback and failure", async () => {
    await withInstrumentedDatabase(async (database) => {
      const samples: { queryCount: number; failedQueryCount: number; inFlight: number; queuedQueryCount: number }[] = [];

      for (let round = 0; round < 12; round++) {
        await withDatabasePoolWindow(async (window): Promise<void> => {

          await database.execute(raw`select 1`);

          await database.transaction(async (transaction) => {
            await transaction.execute(raw`select 2`);
            await transaction.execute(raw`select 3`);
          });

          await expect(database.transaction(async (transaction) => {
            await transaction.execute(raw`select 4`);
            throw new Error("outer rolled back");
          })).rejects.toThrow("outer rolled back");

          await expect(database.execute(raw`selec bad syntax`)).rejects.toThrow();

          const sample = window();
          samples.push({
            failedQueryCount: sample.failedQueryCount,
            inFlight: sample.inFlight,
            queryCount: sample.queryCount,
            queuedQueryCount: sample.queuedQueryCount,
          });
        });
      }

      const [first] = samples;
      expect(first).toEqual({
        failedQueryCount: 1,
        inFlight: 0,
        queryCount: 5,
        queuedQueryCount: 0,
      });
      for (const sample of samples) {
        expect(sample).toEqual(first);
      }
    });
  });

  it("keeps a failing query consumed through catch out of the in-flight residue", async () => {
    await withInstrumentedDatabase(async (database) => {
      for (let round = 0; round < 10; round++) {
        await (database.$client as unknown as {
          unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
        })
          .unsafe("selec bad", [])
          .catch(() => null);
      }

      await withDatabasePoolWindow(async (window): Promise<void> => {
        await database.execute(raw`select 1`);
        const sample = window();
        expect(sample.inFlight).toBe(0);
        expect(sample.queuedQueryCount).toBe(0);
        expect(sample.queryCount).toBe(1);
      });
    });
  });
});
