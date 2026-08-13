import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import {
  instrumentDatabasePool,
  openDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const POOL_MAX = 5;

interface Outcome {
  errorMessage: string | null;
  errorName: string | null;
  status: "rejected" | "resolved";
}

const captureOutcome = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { errorMessage: null, errorName: null, status: "resolved" };
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : null,
      status: "rejected",
    };
  }
};

const createDatabases = () => {
  const instrumentedClient = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
  const plainClient = new SQL({ max: POOL_MAX, prepare: false, url: TEST_DATABASE_URL });
  const instrumented = drizzle({ client: instrumentedClient });
  const plain = drizzle({ client: plainClient });
  instrumentDatabasePool(
    instrumentedClient as unknown as Parameters<typeof instrumentDatabasePool>[0],
    POOL_MAX,
  );
  return {
    close: async (): Promise<void> => {
      await instrumentedClient.end();
      await plainClient.end();
    },
    instrumented,
    plain,
  };
};

type Databases = ReturnType<typeof createDatabases>;

const readRows = async (
  database: Databases["plain"],
  table: string,
): Promise<string[]> => {
  const rows = await database.execute(`select label from ${table} order by label`);
  return (rows as unknown as { label: string }[]).map((row) => row.label);
};

describe.skipIf(!TEST_DATABASE_URL)("drizzle behaviour is inert under pool instrumentation", () => {
  let databases: Databases;
  const tables: string[] = [];

  beforeEach(() => {
    resetDatabasePoolTelemetry();
    databases = createDatabases();
  });

  afterEach(async () => {
    for (const table of tables.splice(0, tables.length)) {
      await databases.plain.execute(`drop table if exists ${table}`);
    }
    await databases.close();
  });

  const createTable = async (name: string): Promise<string> => {
    const table = `pool_telemetry_${name}_${Math.floor(Math.random() * 1_000_000)}`;
    tables.push(table);
    await databases.plain.execute(`create table ${table} (label text primary key)`);
    return table;
  };

  it("rolls a thrown transaction back exactly as an uninstrumented client does", async () => {
    const table = await createTable("throw");
    const outcomes: Outcome[] = [];
    const states: string[][] = [];

    for (const database of [databases.plain, databases.instrumented]) {
      await database.execute(`insert into ${table} values ('committed-${database === databases.plain ? "plain" : "instrumented"}')`);
      outcomes.push(await captureOutcome(async () => {
        await database.transaction(async (transaction) => {
          await transaction.execute(`insert into ${table} values ('rolled-back-${Math.random()}')`);
          throw new Error("transaction body failed");
        });
      }));
      states.push(await readRows(databases.plain, table));
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(states[0]).toEqual(["committed-plain"]);
    expect(states[1]).toEqual(["committed-instrumented", "committed-plain"]);
  });

  it("propagates a drizzle rollback identically", async () => {
    const table = await createTable("rollback");
    const outcomes: Outcome[] = [];

    for (const database of [databases.plain, databases.instrumented]) {
      outcomes.push(await captureOutcome(async () => {
        await database.transaction(async (transaction) => {
          await transaction.execute(`insert into ${table} values ('${Math.random()}')`);
          transaction.rollback();
        });
      }));
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(await readRows(databases.plain, table)).toEqual([]);
  });

  it("keeps an inner savepoint rollback from taking the outer transaction with it", async () => {
    const table = await createTable("savepoint");
    const states: string[][] = [];

    for (const database of [databases.plain, databases.instrumented]) {
      const label = database === databases.plain ? "plain" : "instrumented";
      await database.transaction(async (transaction) => {
        await transaction.execute(`insert into ${table} values ('outer-${label}')`);
        await captureOutcome(async () => {
          await transaction.transaction(async (nested) => {
            await nested.execute(`insert into ${table} values ('inner-${label}')`);
            nested.rollback();
          });
        });
      });
      states.push(await readRows(databases.plain, table));
    }

    expect(states[0]).toEqual(["outer-plain"]);
    expect(states[1]).toEqual(["outer-instrumented", "outer-plain"]);
  });

  it("returns identical rows and types for the same query", async () => {
    const plainRows = await databases.plain.execute(
      "select 1 as number, 'text'::text as text, null::int as absent, now() > '2000-01-01' as flag",
    );
    const instrumentedRows = await databases.instrumented.execute(
      "select 1 as number, 'text'::text as text, null::int as absent, now() > '2000-01-01' as flag",
    );

    expect(JSON.parse(JSON.stringify(instrumentedRows))).toEqual(
      JSON.parse(JSON.stringify(plainRows)),
    );
  });

  it("commits every transaction of a storm that oversubscribes the pool, repeatedly", async () => {
    const table = await createTable("storm");
    const transactionCount = 30;

    for (let round = 0; round < 2; round++) {
      const readWindow = openDatabasePoolWindow();
      await Promise.all(Array.from({ length: transactionCount }, (_unused, index) =>
        databases.instrumented.transaction(async (transaction) => {
          await transaction.execute(`insert into ${table} values ('round-${round}-${index}')`);
        })));
      const sample = readWindow();

      expect(sample.queryCount).toBe(transactionCount);
      expect(sample.failedQueryCount).toBe(0);
      expect(sample.inFlight).toBe(0);

      const rows = await readRows(databases.plain, table);
      expect(rows.length).toBe(transactionCount * (round + 1));

      const idleWindow = openDatabasePoolWindow();
      await databases.instrumented.execute("select 1");
      expect(idleWindow()).toMatchObject({
        failedQueryCount: 0,
        inFlight: 0,
        queryCount: 1,
        queuedQueryCount: 0,
      });
    }
  });
});
