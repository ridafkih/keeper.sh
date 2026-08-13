import type { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { afterAll, describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const drizzleWrapped = (cause: unknown): Error =>
  Object.assign(new Error("Failed query: select 1\nparams: ", { cause }), {
    name: "DrizzleQueryError",
  });

describe("getDatabaseErrorDetails on errors that arrive without a wrapper", () => {
  it("reads a server error raised at COMMIT time, where there is no cause to read", () => {
    const error = postgresError(
      'insert or update on table "event_mappings" violates foreign key constraint "event_mappings_event_id_fkey"',
      {
        code: "ERR_POSTGRES_SERVER_ERROR",
        constraint: "event_mappings_event_id_fkey",
        detail: "Key (event_id)=(00000000-0000-0000-0000-000000000000) is not present in table \"events\".",
        errno: "23503",
      },
    );

    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: "event_mappings_event_id_fkey",
      detail: "Key (event_id)=(00000000-0000-0000-0000-000000000000) is not present in table \"events\".",
      message: error.message,
      sqlState: "23503",
    });
  });

  it("reads a pool failure surfaced from inside a transaction, where there is no cause to read", () => {
    const error = postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" });

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
    expect(getDatabaseErrorDetails(error)).not.toBeNull();
    expect(getDatabaseErrorDetails(error)?.message).toBe("Connection closed");
  });

  it("agrees with the classifier about whether the failure came from the database", () => {
    const shapes = [
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
      postgresError("Failed to read data", { code: "ERR_POSTGRES_EXPECTED_REQUEST" }),
      postgresError("terminating connection due to administrator command", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57P01",
      }),
    ];

    for (const error of shapes) {
      expect(classifyDatabaseError(error)).not.toBeNull();
      expect(getDatabaseErrorDetails(error)).not.toBeNull();
    }
  });
});

describe("getDatabaseErrorDetails sqlState field", () => {
  it("never reports a Bun driver code in the field the services log as a SQLSTATE", () => {
    const error = drizzleWrapped(
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
    );

    const { sqlState } = getDatabaseErrorDetails(error) ?? { sqlState: null };
    if (sqlState !== null) {
      expect(sqlState).toMatch(SQLSTATE_PATTERN);
    }
  });

  it("does not contradict the SQLSTATE the classifier reports for the same error", () => {
    const error = drizzleWrapped(
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
    );

    const classified = classifyDatabaseError(error);
    const details = getDatabaseErrorDetails(error);

    expect(details?.sqlState ?? null).toBe(classified?.sqlState ?? null);
  });
});

describe("classifyDatabaseError stays inert for non-database failures", () => {
  it("ignores a numeric errno from a Node-style socket error", () => {
    const error = Object.assign(new Error("connect ECONNRESET 10.0.0.1:443"), {
      code: "ECONNRESET",
      errno: -54,
      syscall: "connect",
    });

    expect(classifyDatabaseError(error)).toBeNull();
  });

  it("leaves an ordinary server error unclassified even at depth zero", () => {
    const error = postgresError("violates foreign key constraint", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23503",
    });

    expect(classifyDatabaseError(error)).toBeNull();
  });

  it("ignores a provider payload whose body happens to carry a lifecycle-looking code", () => {
    const error = Object.assign(new Error("Outlook returned 503"), {
      statusCode: 503,
      cause: { body: { errno: "57P01" } },
    });

    expect(classifyDatabaseError(error)).toBeNull();
  });

  it("returns the same result for the same error however many times it is asked", () => {
    const error = drizzleWrapped(
      postgresError("terminating connection due to administrator command", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57P01",
      }),
    );

    const runs = Array.from({ length: 6 }, () => JSON.stringify(classifyDatabaseError(error)));
    expect(new Set(runs).size).toBe(1);
    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
  });
});

type Database = ReturnType<typeof drizzle> & { $client: SQL };

const openClients: Database[] = [];

const trackedDatabase = (options: Record<string, unknown> = {}): Database => {
  const database = drizzle({
    connection: { url: databaseUrl ?? "", max: 1, prepare: false, ...options },
  }) as Database;
  openClients.push(database);
  return database;
};

const captureFailure = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
};

afterAll(() => {
  for (const database of openClients) {
    database.$client.close();
  }
});

describe.skipIf(!databaseUrl)("getDatabaseErrorDetails against a live Bun SQL pool", () => {
  it("keeps the constraint name for a violation surfaced at COMMIT", async () => {
    const database = trackedDatabase();
    await database.execute(sql`drop table if exists details_child, details_parent cascade`);
    await database.execute(sql`create table details_parent (id int primary key)`);
    await database.execute(sql`create table details_child (
      id int primary key,
      parent_id int references details_parent(id) deferrable initially deferred
    )`);

    try {
      const error = await captureFailure(() =>
        database.transaction(async (transaction) => {
          await transaction.execute(sql`insert into details_child values (1, 999)`);
        }),
      );

      const details = getDatabaseErrorDetails(error);
      expect(details).not.toBeNull();
      expect(details?.sqlState).toBe("23503");
      expect(details?.constraint).toBe("details_child_parent_id_fkey");
    } finally {
      await database.execute(sql`drop table if exists details_child, details_parent cascade`);
    }
  }, 20_000);

  it("still describes the failure when a backend dies inside a transaction", async () => {
    const database = trackedDatabase();
    const killer = trackedDatabase();

    const error = await captureFailure(() =>
      database.transaction(async (transaction) => {
        const result = await transaction.execute(sql`select pg_backend_pid() as pid`);
        const rows = (result as { rows?: { pid: number }[] }).rows ?? result;
        const [row] = rows as { pid: number }[];
        if (!row) {
          throw new Error("expected pg_backend_pid() to return a row");
        }
        setTimeout(() => {
          killer.execute(sql`select pg_terminate_backend(${Number(row.pid)})`).catch(
            (terminationError: unknown) => {
              throw terminationError;
            },
          );
        }, 150);
        await transaction.execute(sql`select pg_sleep(3)`);
      }),
    );

    expect(classifyDatabaseError(error)).not.toBeNull();
    expect(getDatabaseErrorDetails(error)).not.toBeNull();
  }, 20_000);

  it("reports a SQLSTATE-shaped value or nothing for a closed pooled connection", async () => {
    const database = trackedDatabase();
    await database.execute(sql`select 1`);
    database.$client.close();

    const error = await captureFailure(() => database.execute(sql`select 1`));

    const { sqlState } = getDatabaseErrorDetails(error) ?? { sqlState: null };
    if (sqlState !== null) {
      expect(sqlState).toMatch(SQLSTATE_PATTERN);
    }
  }, 20_000);
});
