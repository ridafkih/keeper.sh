import { eq, sql } from "drizzle-orm";
import { BunSQLPreparedQuery, drizzle } from "drizzle-orm/bun-sql";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  getDatabaseErrorDetails,
  resolveDatabaseErrorClassification,
} from "../../src/utils/errors";
import { keepBoundValuesOutOfQueryErrors } from "../../src/utils/query-errors";

const BOUND_EMAIL = ["ada.lovelace", "example.com"].join("@");
const BOUND_TOKEN = ["ya29", "bound-access-token"].join(".");

const accounts = pgTable("accounts", {
  email: text("email").notNull(),
  token: text("token").notNull(),
});

type DriverError = Error & Record<string, unknown>;

const postgresError = (message: string, fields: Record<string, unknown>): DriverError =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const uniqueViolation = (): DriverError =>
  postgresError('duplicate key value violates unique constraint "accounts_email_key"', {
    code: "ERR_POSTGRES_SERVER_ERROR",
    constraint: "accounts_email_key",
    detail: `Key (email)=(${BOUND_EMAIL}) already exists.`,
    errno: "23505",
    table: "accounts",
  });

const invalidInput = (): DriverError =>
  postgresError(`invalid input syntax for type uuid: "${BOUND_EMAIL}"`, {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "22P02",
    where: `unnamed portal parameter $1 = '${BOUND_EMAIL}'`,
  });

const statementTimeout = (): DriverError =>
  postgresError("canceling statement due to statement timeout", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57014",
  });

const failingDatabase = (failure: unknown) => {
  const rejected = (): Promise<never> & { values: () => Promise<never> } => {
    const settled = Promise.reject(failure);
    return Object.assign(settled, { values: () => settled });
  };
  return drizzle({ client: { unsafe: rejected } as never });
};

const captureFailure = async (run: () => PromiseLike<unknown>): Promise<Error & Record<string, unknown>> => {
  try {
    await run();
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  throw new Error("expected the query to fail");
};

const insertAccount = (failure: unknown) => (): PromiseLike<unknown> =>
  failingDatabase(failure).insert(accounts).values({ email: BOUND_EMAIL, token: BOUND_TOKEN });

const everythingPrinted = (error: unknown): string =>
  [Bun.inspect(error), String((error as Error).stack), JSON.stringify(error)].join("\n");

keepBoundValuesOutOfQueryErrors();

describe("a failed query once bound values are kept out of its error", () => {
  it("reports the statement text and nothing that was bound to it", async () => {
    const error = await captureFailure(insertAccount(uniqueViolation()));

    expect(error.message).toBe('Failed query: insert into "accounts" ("email", "token") values ($1, $2)');
    expect(error.query).toBe('insert into "accounts" ("email", "token") values ($1, $2)');
    expect("params" in error).toBe(false);
    expect(everythingPrinted(error)).not.toContain(BOUND_EMAIL);
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("covers a query that maps its rows", async () => {
    const error = await captureFailure(() =>
      failingDatabase(statementTimeout())
        .select({ token: accounts.token })
        .from(accounts)
        .where(eq(accounts.email, BOUND_EMAIL)));

    expect(error.message).toBe('Failed query: select "token" from "accounts" where "accounts"."email" = $1');
    expect(everythingPrinted(error)).not.toContain(BOUND_EMAIL);
  });

  it("covers a raw statement", async () => {
    const error = await captureFailure(() =>
      failingDatabase(statementTimeout()).execute(sql`select ${BOUND_TOKEN}::text`));

    expect(error.message).toBe("Failed query: select $1::text");
    expect(everythingPrinted(error)).not.toContain(BOUND_TOKEN);
  });

  it("keeps the stack frames beneath the rewritten message", async () => {
    const error = await captureFailure(insertAccount(uniqueViolation()));

    expect(String(error.stack)).toContain("Failed query: insert into");
    expect(String(error.stack)).toContain("\n    at ");
    expect(String(error.stack)).not.toContain("params:");
  });

  it("hands the caller the driver's own error as the cause", async () => {
    const cause = uniqueViolation();
    const error = await captureFailure(insertAccount(cause));

    expect(error.cause).toBe(cause);
    expect(error.constructor.name).toBe("DrizzleQueryError");
  });

  it("names the violated key without the value that violated it", async () => {
    const error = await captureFailure(insertAccount(uniqueViolation()));

    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: "accounts_email_key",
      detail: "Key (email)",
      message: 'duplicate key value violates unique constraint "accounts_email_key"',
      sqlState: "23505",
    });
    expect(resolveDatabaseErrorClassification(error)).toEqual({
      slug: "db-query-failed",
      sqlState: "23505",
    });
  });

  it("reports a rejected value by its condition only", async () => {
    const error = await captureFailure(insertAccount(invalidInput()));
    const cause = error.cause as DriverError;

    expect(cause.message).toBe("invalid input syntax for type uuid");
    expect("where" in cause).toBe(false);
    expect(cause.errno).toBe("22P02");
    expect(everythingPrinted(error)).not.toContain(BOUND_EMAIL);
  });

  it("leaves the classification of a statement timeout as it was", async () => {
    const error = await captureFailure(insertAccount(statementTimeout()));

    expect(resolveDatabaseErrorClassification(error)).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
    expect((error.cause as DriverError).message).toBe("canceling statement due to statement timeout");
  });

  it("removes the parameters when the driver fails without a database error", async () => {
    const error = await captureFailure(insertAccount(new TypeError("socket hang up")));

    expect(error.message).toBe('Failed query: insert into "accounts" ("email", "token") values ($1, $2)');
    expect((error.cause as Error).message).toBe("socket hang up");
    expect(resolveDatabaseErrorClassification(error)).toBeNull();
  });

  it("wraps the query runner once however many databases are created", () => {
    const runner = Reflect.get(BunSQLPreparedQuery.prototype, "queryWithCache");

    keepBoundValuesOutOfQueryErrors();

    expect(Reflect.get(BunSQLPreparedQuery.prototype, "queryWithCache")).toBe(runner);
  });
});
