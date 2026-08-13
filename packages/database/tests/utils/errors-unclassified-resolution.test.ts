import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import {
  classifyDatabaseError,
  resolveDatabaseErrorClassification,
} from "../../src/utils/errors";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const upsert = (cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"sync_status\" (\"calendar_id\") values ($1) on conflict (\"calendar_id\") do update set \"last_synced_at\" = $2",
    ["calendar-1"],
    cause,
  );

describe("resolving a slug for database failures the pool classifier does not name", () => {
  it("names a pool failure exactly as the pool classifier does", () => {
    const error = upsert(postgresError("Connection closed", {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    }));

    expect(resolveDatabaseErrorClassification(error)).toEqual(
      classifyDatabaseError(error),
    );
  });

  it.each([
    ["40P01", "deadlock detected"],
    ["23505", "duplicate key value violates unique constraint \"sync_status_pkey\""],
    ["40001", "could not serialize access due to concurrent update"],
    ["23514", "violates check constraint \"calendars_sync_future_range_check\""],
  ])("names a %s server error as a database failure carrying its sqlstate", (errno, message) => {
    const error = upsert(postgresError(message, {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno,
    }));

    expect(classifyDatabaseError(error)).toBeNull();
    expect(resolveDatabaseErrorClassification(error)).toEqual({
      slug: "db-query-failed",
      sqlState: errno,
    });
  });

  it("names nothing when the failure never came from the database", () => {
    expect(resolveDatabaseErrorClassification(
      Object.assign(new Error("Precondition Failed"), { statusCode: 412 }),
    )).toBeNull();
  });

  it("names nothing for a provider error whose text merely mentions a conflict", () => {
    expect(resolveDatabaseErrorClassification(
      new Error("CalDAV reported a conflict on 409"),
    )).toBeNull();
  });
});
