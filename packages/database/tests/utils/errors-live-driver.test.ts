import type { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { afterAll, describe, expect, it } from "vitest";
import { classifyDatabaseError } from "../../src/utils/errors";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const CONNECTION_SLUGS = ["db-connection-unavailable", "db-connection-terminated"];

type Database = ReturnType<typeof drizzle> & { $client: SQL };

const openDatabase = (options: Record<string, unknown> = {}): Database =>
  drizzle({
    connection: { url: databaseUrl ?? "", max: 1, prepare: false, ...options },
  }) as Database;

const firstBackendPid = (result: unknown): number => {
  const rows = (result as { rows?: { pid: number }[] }).rows ?? result;
  const [row] = rows as { pid: number }[];
  if (!row) {
    throw new Error("expected pg_backend_pid() to return a row");
  }
  return Number(row.pid);
};

const readBackendPid = async (database: Database): Promise<number> =>
  firstBackendPid(await database.execute(sql`select pg_backend_pid() as pid`));

const readBackendPidWithRecovery = async (
  database: Database,
  observedSlugs: (string | undefined)[],
): Promise<number> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await readBackendPid(database);
    } catch (error) {
      observedSlugs.push(classifyDatabaseError(error)?.slug);
      await Bun.sleep(100);
    }
  }
  return await readBackendPid(database);
};

const terminationFailures: unknown[] = [];

const scheduleTermination = (killer: Database, pid: number, delayMs: number): void => {
  setTimeout(() => {
    killer.execute(sql`select pg_terminate_backend(${pid})`).catch((terminationError: unknown) => {
      terminationFailures.push(terminationError);
    });
  }, delayMs);
};

const captureFailure = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
};

const openClients: Database[] = [];

const trackedDatabase = (options: Record<string, unknown> = {}): Database => {
  const database = openDatabase(options);
  openClients.push(database);
  return database;
};

afterAll(() => {
  for (const database of openClients) {
    database.$client.close();
  }
});

describe.skipIf(!databaseUrl)("classifyDatabaseError against a live Bun SQL pool", () => {
  it("classifies a statement timeout raised inside a transaction", async () => {
    const database = trackedDatabase();

    const error = await captureFailure(() =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('statement_timeout', '200', true)`);
        await transaction.execute(sql`select pg_sleep(2)`);
      }),
    );

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
  }, 20_000);

  it("classifies a backend terminated in the middle of a transaction", async () => {
    const database = trackedDatabase();
    const killer = trackedDatabase();

    const failure = await captureFailure(() =>
      database.transaction(async (transaction) => {
        const pid = firstBackendPid(
          await transaction.execute(sql`select pg_backend_pid() as pid`),
        );
        scheduleTermination(killer, pid, 150);
        await transaction.execute(sql`select pg_sleep(3)`);
      }),
    );

    expect(terminationFailures).toEqual([]);
    expect(classifyDatabaseError(failure)?.slug).toBeOneOf(CONNECTION_SLUGS);
  }, 20_000);

  it("classifies a session dropped by idle_in_transaction_session_timeout", async () => {
    const database = trackedDatabase();

    const error = await captureFailure(() =>
      database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select set_config('idle_in_transaction_session_timeout', '300', true)`,
        );
        await transaction.execute(sql`select 1`);
        await Bun.sleep(1200);
        await transaction.execute(sql`select 2`);
      }),
    );

    expect(classifyDatabaseError(error)?.slug).toBeOneOf(CONNECTION_SLUGS);
  }, 20_000);

  it("classifies a connection reclaimed by the pool max lifetime", async () => {
    const database = trackedDatabase({ maxLifetime: 1 });

    const error = await captureFailure(async () => {
      await database.execute(sql`select 1`);
      await Bun.sleep(1500);
      await database.transaction(async (transaction) => {
        await transaction.execute(sql`select 1`);
        await Bun.sleep(1500);
        await transaction.execute(sql`select 2`);
      });
    });

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
  }, 20_000);

  it("classifies a pool that can never reach the server", async () => {
    const unreachable = drizzle({
      connection: { url: "postgres://nobody:nobody@127.0.0.1:1/none", max: 1, prepare: false },
    }) as Database;

    const error = await captureFailure(() => unreachable.execute(sql`select 1`));

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
  }, 20_000);

  it("classifies every in-flight query when the backend dies under concurrency", async () => {
    const database = trackedDatabase({ max: 4 });
    const killer = trackedDatabase();

    await database.execute(sql`select 1`);
    const inFlight = Array.from({ length: 8 }, async () => {
      try {
        await database.execute(sql`select pg_sleep(2)`);
        return null;
      } catch (error) {
        return error;
      }
    });
    await Bun.sleep(250);
    await killer.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity
          where query like '%pg_sleep(2)%' and pid <> pg_backend_pid()`,
    );

    const settled = await Promise.all(inFlight);
    const failures = settled.filter((entry) => entry !== null);

    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(classifyDatabaseError(failure)?.slug).toBeOneOf(CONNECTION_SLUGS);
    }
  }, 30_000);

  it("classifies a connection refused by the server connection limit", async () => {
    const administrator = trackedDatabase({ max: 2 });
    await administrator.execute(sql`drop role if exists keeper_conn_limit_probe`);
    await administrator.execute(
      sql`create role keeper_conn_limit_probe login password 'probe' connection limit 1`,
    );

    const limitedUrl = new URL(databaseUrl ?? "");
    limitedUrl.username = "keeper_conn_limit_probe";
    limitedUrl.password = "probe";

    const holder = trackedDatabase({ url: limitedUrl.toString() });
    const blocked = trackedDatabase({ url: limitedUrl.toString() });

    try {
      await holder.execute(sql`select 1`);
      const error = await captureFailure(() => blocked.execute(sql`select 1`));

      expect(classifyDatabaseError(error)).not.toBeNull();
    } finally {
      holder.$client.close();
      blocked.$client.close();
      await administrator.execute(sql`drop role if exists keeper_conn_limit_probe`);
    }
  }, 20_000);

  it("classifies repeated connection failures identically and lets the pool recover", async () => {
    const database = trackedDatabase();
    const killer = trackedDatabase();
    const slugs: (string | undefined)[] = [];

    for (let round = 0; round < 3; round++) {
      const pid = await readBackendPidWithRecovery(database, slugs);
      const failure = await captureFailure(async () => {
        scheduleTermination(killer, pid, 150);
        await database.execute(sql`select pg_sleep(3)`);
      });
      slugs.push(classifyDatabaseError(failure)?.slug);
    }

    expect(terminationFailures).toEqual([]);
    expect([...new Set(slugs)]).toEqual([slugs[0]]);
    expect(slugs[0]).toBeOneOf(CONNECTION_SLUGS);
    await expect(readBackendPidWithRecovery(database, [])).resolves.toBeTypeOf("number");
  }, 40_000);
});
