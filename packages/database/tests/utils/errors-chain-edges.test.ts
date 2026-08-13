import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import {
  classifyDatabaseError,
  getDatabaseErrorDetails,
  isDatabaseError,
} from "../../src/utils/errors";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const closedConnection = (): Error =>
  postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" });

const wrapTimes = (root: Error, times: number): Error => {
  let wrapped: Error = root;
  for (let index = 0; index < times; index += 1) {
    wrapped = new Error(`wrapper ${index}`, { cause: wrapped });
  }
  return wrapped;
};

describe("classifyDatabaseError chain traversal edges", () => {
  it("finds a pooled failure through the deepest realistic ingest nesting", () => {
    const perSource = new DrizzleQueryError(
      "select \"id\" from \"calendar_sources\"",
      [],
      closedConnection(),
    );
    const jobLevel = new AggregateError(
      [new AggregateError([perSource], "provider batch failed")],
      "Calendar source ingestion completed with failures",
    );

    expect(classifyDatabaseError(jobLevel)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("still classifies at four levels of cause wrapping", () => {
    expect(classifyDatabaseError(wrapTimes(closedConnection(), 4))).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("converges on a cyclic cause chain instead of looping forever", () => {
    const outer: Error & { cause?: unknown } = new Error("outer");
    const inner = postgresError("terminating connection due to administrator command", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "57P01",
    });
    outer.cause = inner;
    inner.cause = outer;

    expect(classifyDatabaseError(outer)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
    expect(classifyDatabaseError(inner)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("ignores non-object members of an AggregateError", () => {
    const aggregate = new AggregateError(
      [null, "connection closed", 404, closedConnection()],
      "mixed failures",
    );

    expect(classifyDatabaseError(aggregate)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("returns null for an empty AggregateError and for absent errors", () => {
    expect(classifyDatabaseError(new AggregateError([], "nothing failed"))).toBeNull();
    expect(classifyDatabaseError(null)).toBeNull();
    expect(isDatabaseError(null)).toBe(false);
  });

  it("classifies the same incident identically on repeated calls", () => {
    const incident = new DrizzleQueryError(
      "select \"id\" from \"calendar_sources\"",
      [],
      postgresError("too many connections for role \"keeper\"", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "53300",
      }),
    );
    const runs = Array.from({ length: 5 }, () => classifyDatabaseError(incident));

    expect(runs).toEqual(
      Array.from({ length: 5 }, () => ({
        slug: "db-connection-unavailable",
        sqlState: "53300",
      })),
    );
  });

  it("reports details from the same link the classifier chose across both aggregate branches", () => {
    const aggregate = new AggregateError(
      [
        new Error("plain provider failure"),
        new DrizzleQueryError(
          "insert into \"event_states\"",
          [],
          postgresError("terminating connection due to administrator command", {
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "57P01",
          }),
        ),
      ],
      "ingest failed",
    );

    expect(classifyDatabaseError(aggregate)?.sqlState).toBe("57P01");
    expect(getDatabaseErrorDetails(aggregate)?.sqlState).toBe("57P01");
    expect(getDatabaseErrorDetails(aggregate)?.message).toBe(
      "terminating connection due to administrator command",
    );
  });

  it("does not treat a socket failure carrying a numeric errno as a database error", () => {
    const socketFailure = Object.assign(
      new Error("write EPIPE while reading calendar 404 feed"),
      { code: "EPIPE", errno: -32, syscall: "write" },
    );

    expect(isDatabaseError(socketFailure)).toBe(false);
    expect(getDatabaseErrorDetails(socketFailure)).toBeNull();
  });
});
