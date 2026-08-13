import type { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { DrizzleQueryError, TransactionRollbackError } from "drizzle-orm/errors";
import { afterAll, describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const postgresError = (
  fields: Record<string, unknown> & { message: string },
): Error & Record<string, unknown> => {
  const { message, ...rest } = fields;
  return Object.assign(new Error(message), rest);
};

const terminatedBackend = (): Error =>
  postgresError({
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57P01",
    message: "terminating connection due to administrator command",
  });

const closedConnection = (): Error =>
  postgresError({
    code: "ERR_POSTGRES_CONNECTION_CLOSED",
    message: "Connection closed",
  });

const wrappedByDrizzle = (cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "update \"calendars\" set \"sync_token\" = $1 where \"id\" = $2",
    ["tok-1", "cal-1"],
    cause,
  );

describe("database errors nested more than one level deep", () => {
  it("classifies a pool failure that the mapping mutation re-throws inside an AggregateError", () => {
    const queryFailure = wrappedByDrizzle(terminatedBackend());
    const error = new AggregateError(
      [queryFailure, new Error("Failed to release mapping mutation locks")],
      "Mapping mutation failed and its locks could not be fully released",
      { cause: queryFailure },
    );

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("describes that same nested pool failure instead of going dark", () => {
    const queryFailure = wrappedByDrizzle(closedConnection());
    const error = new AggregateError([queryFailure], "locks not released", {
      cause: queryFailure,
    });

    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: null,
      detail: null,
      message: "Connection closed",
      sqlState: null,
    });
  });

  it("keeps the classifier and the detail reader agreeing at every nesting depth", () => {
    const bare = terminatedBackend();
    const wrapped = wrappedByDrizzle(terminatedBackend());
    const nested = new AggregateError([wrapped], "outer", { cause: wrapped });

    for (const error of [bare, wrapped, nested]) {
      expect([error, classifyDatabaseError(error) !== null]).toEqual([error, true]);
      expect([error, getDatabaseErrorDetails(error) !== null]).toEqual([error, true]);
    }
  });
});

describe("database error helpers on deliberate and non-database failures", () => {
  it("leaves an explicit transaction rollback unclassified and undescribed", () => {
    const error = new TransactionRollbackError();

    expect(classifyDatabaseError(error)).toBeNull();
    expect(getDatabaseErrorDetails(error)).toBeNull();
  });

  it("reports the server message rather than the query and parameters drizzle prints", () => {
    const error = wrappedByDrizzle(
      postgresError({
        code: "ERR_POSTGRES_SERVER_ERROR",
        constraint: "calendars_pkey",
        detail: "Key (id)=(cal-1) already exists.",
        errno: "23505",
        message: "duplicate key value violates unique constraint \"calendars_pkey\"",
      }),
    );

    const details = getDatabaseErrorDetails(error);

    expect(details?.message).toBe("duplicate key value violates unique constraint \"calendars_pkey\"");
    expect(details?.message).not.toContain("params:");
    expect(details?.sqlState).toBe("23505");
    expect(classifyDatabaseError(error)).toBeNull();
  });

  it("does not let a provider failure inherit a database classification through its cause", () => {
    const error = Object.assign(new Error("Outlook returned 503"), { status: 503 });

    expect(classifyDatabaseError(error)).toBeNull();
    expect(getDatabaseErrorDetails(error)).toBeNull();
  });
});

describe("repeated classification of one incident", () => {
  it("converges on a single answer across many calls and many error instances", () => {
    const answers = Array.from({ length: 25 }, () =>
      JSON.stringify(classifyDatabaseError(wrappedByDrizzle(terminatedBackend()))));

    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0] as string)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });
});

type LiveDatabase = ReturnType<typeof drizzle> & { $client: SQL };

const openClients: LiveDatabase[] = [];

const openDatabase = (): LiveDatabase => {
  const database = drizzle({
    connection: { url: databaseUrl ?? "", max: 1, prepare: false },
  }) as LiveDatabase;
  openClients.push(database);
  return database;
};

afterAll(() => {
  for (const database of openClients) {
    database.$client.close();
  }
});

const readBackendPid = async (database: LiveDatabase): Promise<number> => {
  const result = await database.execute(sql`select pg_backend_pid() as pid`);
  const rows = (result as { rows?: { pid: number }[] }).rows ?? (result as { pid: number }[]);
  const [row] = rows;
  if (!row) {
    throw new Error("expected pg_backend_pid() to return a row");
  }
  return Number(row.pid);
};

const terminationFailures: unknown[] = [];

const captureFailure = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
};

describe.skipIf(!databaseUrl)("what a live pool failure actually looks like to the ingest job", () => {
  it("embeds the failed query parameters in the message the ingest job inspects", async () => {
    const database = openDatabase();
    const killer = openDatabase();
    const pid = await readBackendPid(database);

    setTimeout(() => {
      killer.execute(sql`select pg_terminate_backend(${pid})`).catch((terminationError: unknown) => {
        terminationFailures.push(terminationError);
      });
    }, 120);

    const failure = await captureFailure(() =>
      database.execute(
        sql`select ${"20260404T090000Z-9f3@keeper.sh"}::text as uid, ${"https://caldav.example.com/cal/404abc/"}::text as url from pg_sleep(2)`,
      ));

    expect(terminationFailures).toEqual([]);
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).toContain("404");
    expect(classifyDatabaseError(failure)).not.toBeNull();
  });
});
