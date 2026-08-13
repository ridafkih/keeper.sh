import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { classifyDatabaseError, isDatabaseError } from "../../src/utils/errors";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const connectionClosed = (): Error & Record<string, unknown> =>
  postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" });

const adminShutdown = (): Error & Record<string, unknown> =>
  postgresError("terminating connection due to administrator command", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57P01",
  });

const tooManyConnections = (): Error & Record<string, unknown> =>
  postgresError("too many connections for role \"keeper_app\"", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "53300",
  });

const sourceListingQuery = (table: string, cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    `select "id", "user_id" from "${table}" inner join "calendar_accounts" on true`,
    [],
    cause,
  );

const jobLevelFailure = (causes: Error[]): AggregateError =>
  new AggregateError(
    causes.map((cause, index) => sourceListingQuery(`calendars_${index}`, cause)),
    "Calendar source ingestion completed with failures",
  );

describe("the error shape the cron job builds when the pool is unreachable", () => {
  it("classifies the aggregate of the three source-listing queries as one pool failure", () => {
    const error = jobLevelFailure([connectionClosed(), connectionClosed(), connectionClosed()]);

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
    expect(isDatabaseError(error)).toBe(true);
  });

  it("reports a SQLSTATE when the server, not the driver, ends the connections", () => {
    const error = jobLevelFailure([adminShutdown(), adminShutdown(), adminShutdown()]);

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("classifies a mixed aggregate the same way whichever listing failed first", () => {
    const orders = [
      [connectionClosed(), adminShutdown(), tooManyConnections()],
      [tooManyConnections(), connectionClosed(), adminShutdown()],
      [adminShutdown(), tooManyConnections(), connectionClosed()],
    ];

    const slugs = orders.map((causes) => classifyDatabaseError(jobLevelFailure(causes))?.slug);

    expect(slugs).toEqual([
      "db-connection-unavailable",
      "db-connection-unavailable",
      "db-connection-unavailable",
    ]);
  });

  it("stays unclassified when a single listing fails for a reason of its own", () => {
    const error = jobLevelFailure([
      postgresError("relation \"calendars\" does not exist", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "42P01",
      }),
    ]);

    expect(classifyDatabaseError(error)).toBeNull();
    expect(isDatabaseError(error)).toBe(true);
  });

  it("classifies an aggregate that carries no failures at all as nothing", () => {
    const error = new AggregateError([], "Calendar source ingestion completed with failures");

    expect(classifyDatabaseError(error)).toBeNull();
    expect(isDatabaseError(error)).toBe(false);
  });
});
