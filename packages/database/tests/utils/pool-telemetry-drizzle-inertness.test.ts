import { describe, expect, it } from "vitest";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import {
  instrumentDatabasePool,
  withDatabasePoolWindow,
  resetDatabasePoolTelemetry,
} from "../../src/utils/pool-telemetry";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const POOL_MAX = 5;

interface Outcome {
  errorMessage: string | null;
  errorName: string | null;
  status: "rejected" | "resolved";
}

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const readErrorName = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.name;
  }
  return null;
};

const captureOutcome = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { errorMessage: null, errorName: null, status: "resolved" };
  } catch (error) {
    return {
      errorMessage: readErrorMessage(error),
      errorName: readErrorName(error),
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

interface DatabaseFixture {
  createTable: (name: string) => Promise<string>;
  databases: Databases;
  labelled: [label: string, database: Databases["plain"]][];
}

const withDatabases = async (
  body: (fixture: DatabaseFixture) => Promise<void>,
): Promise<void> => {
  resetDatabasePoolTelemetry();
  const databases = createDatabases();
  const tables: string[] = [];
  const createTable = async (name: string): Promise<string> => {
    const table = `pool_telemetry_${name}_${Math.floor(Math.random() * 1_000_000)}`;
    tables.push(table);
    await databases.plain.execute(`create table ${table} (label text primary key)`);
    return table;
  };

  try {
    await body({
      createTable,
      databases,
      labelled: [["plain", databases.plain], ["instrumented", databases.instrumented]],
    });
  } finally {
    for (const table of tables) {
      await databases.plain.execute(`drop table if exists ${table}`);
    }
    await databases.close();
  }
};

describe.skipIf(!TEST_DATABASE_URL)("drizzle behaviour is inert under pool instrumentation", () => {
  it("rolls a thrown transaction back exactly as an uninstrumented client does", async () => {
    await withDatabases(async ({ createTable, databases, labelled }): Promise<void> => {
      const table = await createTable("throw");
      const outcomes: Outcome[] = [];
      const states: string[][] = [];

      for (const [label, database] of labelled) {
        await database.execute(`insert into ${table} values ('committed-${label}')`);
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
  });

  it("propagates a drizzle rollback identically", async () => {
    await withDatabases(async ({ createTable, databases, labelled }): Promise<void> => {
      const table = await createTable("rollback");
      const outcomes: Outcome[] = [];

      for (const [, database] of labelled) {
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
  });

  it("keeps an inner savepoint rollback from taking the outer transaction with it", async () => {
    await withDatabases(async ({ createTable, databases, labelled }): Promise<void> => {
      const table = await createTable("savepoint");
      const states: string[][] = [];

      for (const [label, database] of labelled) {
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
  });

  it("returns identical rows and types for the same query", async () => {
    await withDatabases(async ({ databases }): Promise<void> => {
      const plainRows = await databases.plain.execute(
        "select 1 as number, 'text'::text as text, null::int as absent, now() > '2000-01-01' as flag",
      );
      const instrumentedRows = await databases.instrumented.execute(
        "select 1 as number, 'text'::text as text, null::int as absent, now() > '2000-01-01' as flag",
      );

      expect(structuredClone(instrumentedRows)).toEqual(structuredClone(plainRows));
    });
  });

  it("commits every transaction of a storm that oversubscribes the pool, repeatedly", async () => {
    await withDatabases(async ({ createTable, databases }): Promise<void> => {
      const table = await createTable("storm");
      const transactionCount = 30;

      for (let round = 0; round < 2; round++) {
        await withDatabasePoolWindow(async (readWindow): Promise<void> => {
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

          await withDatabasePoolWindow(async (idleWindow): Promise<void> => {
            await databases.instrumented.execute("select 1");
            expect(idleWindow()).toMatchObject({
              failedQueryCount: 0,
              inFlight: 0,
              queryCount: 1,
              queuedQueryCount: 0,
            });
          });
        });
      }
    });
  });
});
