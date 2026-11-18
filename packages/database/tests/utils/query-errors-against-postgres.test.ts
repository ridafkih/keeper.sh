import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/utils/database";
import type { DatabaseInstance } from "../../src/utils/database";
import {
  getDatabaseErrorDetails,
  resolveDatabaseErrorClassification,
} from "../../src/utils/errors";

const databaseUrl = process.env.KEEPER_TEST_DATABASE_URL;

const PRINTER = new URL("support/print-failed-queries.ts", import.meta.url).pathname;

const BOUND_EMAIL = ["ada.lovelace", "example.com"].join("@");
const BOUND_TOKEN = ["ya29", "bound-access-token"].join(".");
const BOUND_VALUES = [BOUND_EMAIL, BOUND_TOKEN];

const FAILURE_NAMES = ["bad-sql", "check", "invalid-input", "not-null", "statement-timeout", "unique"];

interface PrintedRun {
  exitCode: number;
  output: string;
}

const printFailures = async (mode: string): Promise<PrintedRun> => {
  const printer = Bun.spawn(["bun", PRINTER, mode], {
    env: { ...process.env, PROBE_EMAIL: BOUND_EMAIL, PROBE_TOKEN: BOUND_TOKEN },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(printer.stdout).text(),
    new Response(printer.stderr).text(),
  ]);
  return { exitCode: await printer.exited, output: `${stdout}\n${stderr}` };
};

const captureFailure = async (run: () => PromiseLike<unknown>): Promise<Error & Record<string, unknown>> => {
  try {
    await run();
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  throw new Error("expected the query to fail");
};

const everythingPrinted = (error: unknown): string =>
  [Bun.inspect(error), String((error as Error).stack), JSON.stringify(error)].join("\n");

const openDatabases: DatabaseInstance[] = [];

const openAccounts = async (): Promise<DatabaseInstance> => {
  const database = await createDatabase(databaseUrl ?? "", { maxConnections: 1 });
  openDatabases.push(database);
  await database.execute(sql`
    create temp table failing_accounts (
      id uuid primary key,
      email text unique not null,
      owner_id uuid references failing_accounts(id),
      seats int check (seats > 0)
    )
  `);
  await database.execute(sql`
    insert into failing_accounts (id, email, seats)
    values (${"4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77"}, ${BOUND_EMAIL}, ${1})
  `);
  return database;
};

afterAll(() => {
  for (const database of openDatabases) {
    closeDatabase(database);
  }
});

describe.skipIf(!databaseUrl)("a query that fails against Postgres", () => {
  it("reports a unique violation by statement, constraint and key column", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.execute(sql`
      insert into failing_accounts (id, email, seats)
      values (${"0d6d2c1f-9a51-4b7e-6b0f-4f0c1a9e3e77"}, ${BOUND_EMAIL}, ${1})
    `));

    expect(error.message).toContain("Failed query:");
    expect(error.message).toContain("insert into failing_accounts (id, email, seats)");
    expect(error.message).toContain("$1, $2, $3");
    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: "failing_accounts_email_key",
      detail: "Key (email)",
      message: 'duplicate key value violates unique constraint "failing_accounts_email_key"',
      sqlState: "23505",
    });
    expect(resolveDatabaseErrorClassification(error)).toEqual({ slug: "db-query-failed", sqlState: "23505" });
    expect(everythingPrinted(error)).not.toContain(BOUND_EMAIL);
  });

  it("keeps a foreign key made of an internal identifier", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.execute(sql`
      insert into failing_accounts (id, email, owner_id, seats)
      values (${"0d6d2c1f-9a51-4b7e-6b0f-4f0c1a9e3e77"}, ${BOUND_TOKEN}, ${"00000000-0000-0000-0000-000000000000"}, ${1})
    `));

    expect(getDatabaseErrorDetails(error)?.detail).toBe(
      'Key (owner_id)=(00000000-0000-0000-0000-000000000000) is not present in table "failing_accounts".',
    );
    expect(getDatabaseErrorDetails(error)?.sqlState).toBe("23503");
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("drops the failing row of a check violation", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.execute(sql`
      insert into failing_accounts (id, email, seats)
      values (${"0d6d2c1f-9a51-4b7e-6b0f-4f0c1a9e3e77"}, ${BOUND_TOKEN}, ${0})
    `));

    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: "failing_accounts_seats_check",
      detail: null,
      message: 'new row for relation "failing_accounts" violates check constraint "failing_accounts_seats_check"',
      sqlState: "23514",
    });
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("reports a rejected value by its condition", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.execute(sql`select ${BOUND_TOKEN}::int`));

    expect(error.message).toBe("Failed query: select $1::int");
    expect(getDatabaseErrorDetails(error)?.message).toBe("invalid input syntax for type integer");
    expect(getDatabaseErrorDetails(error)?.sqlState).toBe("22P02");
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("classifies a statement timeout inside a transaction as before", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.transaction(async (transaction) => {
      await transaction.execute(sql`set local statement_timeout = 100`);
      await transaction.execute(sql`select pg_sleep(2), ${BOUND_TOKEN}::text`);
    }));

    expect(error.message).toBe("Failed query: select pg_sleep(2), $1::text");
    expect(resolveDatabaseErrorClassification(error)).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("reports a statement Postgres cannot parse", async () => {
    const database = await openAccounts();
    const error = await captureFailure(() => database.execute(sql`selec ${BOUND_TOKEN}`));

    expect(error.message).toBe("Failed query: selec $1");
    expect(getDatabaseErrorDetails(error)?.message).toBe('syntax error at or near "selec"');
    expect(resolveDatabaseErrorClassification(error)).toEqual({ slug: "db-query-failed", sqlState: "42601" });
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("passes an error thrown by the transaction body through untouched", async () => {
    const database = await openAccounts();
    const thrown = new Error(`Calendar ${BOUND_EMAIL} is not owned by the user`);

    const error = await captureFailure(() => database.transaction(() => Promise.reject(thrown)));

    expect(error).toBe(thrown);
    expect(error.message).toBe(`Calendar ${BOUND_EMAIL} is not owned by the user`);
  });
});

describe.skipIf(!databaseUrl)("what a process writes when a query fails", () => {
  it("prints each failure a job runner reports without a bound value", async () => {
    const { exitCode, output } = await printFailures("reported");

    expect(exitCode).toBe(0);
    for (const name of FAILURE_NAMES) {
      expect(output).toContain(`Cron job '${name}' failed:`);
    }
    for (const sqlState of ["42601", "23514", "22P02", "23502", "57014", "23505"]) {
      expect(output).toContain(`errno: "${sqlState}"`);
    }
    expect(output).toContain("Failed query: insert into printed_accounts values ($1, $2, $3)");
    expect(output).toContain('detail: "Key (email)"');
    expect(output).not.toContain("params:");
    for (const value of BOUND_VALUES) {
      expect(output).not.toContain(value);
    }
  });

  it.each(FAILURE_NAMES)("prints an unhandled %s failure without a bound value", async (name) => {
    const { exitCode, output } = await printFailures(name);

    expect(exitCode).not.toBe(0);
    expect(output).toContain("Failed query: ");
    expect(output).toContain("PostgresError: ");
    expect(output).not.toContain("params:");
    for (const value of BOUND_VALUES) {
      expect(output).not.toContain(value);
    }
  });
});
