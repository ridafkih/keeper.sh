import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const poolClosed = (): Error & Record<string, unknown> =>
  postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" });

const adminShutdown = (): Error & Record<string, unknown> =>
  postgresError("terminating connection due to administrator command", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57P01",
  });

const wrappedQueryFailure = (cause: unknown): DrizzleQueryError =>
  new DrizzleQueryError("insert into \"event_states\" values ($1)", ["evt-1"], cause as Error);

const wrapWithCause = (message: string, cause: unknown): Error =>
  new Error(message, { cause });

describe("classifyDatabaseError on cyclic and self-referential chains", () => {
  it("terminates on an error that is its own cause", () => {
    const error = poolClosed();
    Object.assign(error, { cause: error });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("terminates on a two-error cycle where only the deeper link is the database failure", () => {
    const outer = new Error("persisting the ingested snapshot failed");
    const inner = adminShutdown();
    Object.assign(outer, { cause: inner });
    Object.assign(inner, { cause: outer });

    expect(classifyDatabaseError(outer)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
    expect(getDatabaseErrorDetails(outer)?.sqlState).toBe("57P01");
  });

  it("terminates on a cycle that carries no database failure at all", () => {
    const first = new Error("provider returned 500");
    const second = new Error("retry exhausted");
    Object.assign(first, { cause: second });
    Object.assign(second, { cause: first });

    expect(classifyDatabaseError(first)).toBeNull();
    expect(getDatabaseErrorDetails(first)).toBeNull();
  });

  it("terminates when an AggregateError contains itself", () => {
    const aggregate = new AggregateError([poolClosed()], "source ingest failed");
    aggregate.errors.push(aggregate);

    expect(classifyDatabaseError(aggregate)?.slug).toBe("db-connection-unavailable");
  });
});

describe("classifyDatabaseError on deeply wrapped chains", () => {
  it.each([1, 2, 3, 4])("finds a pool failure %i wrapper(s) deep", (depth) => {
    let error: unknown = poolClosed();
    for (let level = 0; level < depth; level++) {
      error = wrapWithCause(`ingest wrapper ${level}`, error);
    }

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
  });

  it("finds a pool failure that the query builder and an aggregate both wrap", () => {
    const error = new AggregateError(
      [new Error("unrelated calendar failed"), wrappedQueryFailure(adminShutdown())],
      "two calendars failed",
    );

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("finds the pool failure whichever position it holds in an aggregate", () => {
    const others: Error[] = Array.from({ length: 6 }, (_unused, index) =>
      Object.assign(new Error(`calendar ${index} failed: 404 Not Found`), { status: 404 }));

    const slugs = others.map((_unused, index) => {
      const members = [...others];
      members.splice(index, 0, wrappedQueryFailure(poolClosed()));
      return classifyDatabaseError(new AggregateError(members, "ingest failed"))?.slug;
    });

    expect(new Set(slugs)).toEqual(new Set(["db-connection-unavailable"]));
  });
});

describe("classifyDatabaseError on values that are not errors", () => {
  it.each([
    ["a string", "Connection closed"],
    ["null", null],
    ["a number", 57_014],
    ["an empty object", {}],
    ["an array of pool failures", [poolClosed()]],
  ])("stays silent and does not throw for %s", (_label, value) => {
    expect(() => classifyDatabaseError(value)).not.toThrow();
    expect(classifyDatabaseError(value)).toBeNull();
    expect(getDatabaseErrorDetails(value)).toBeNull();
  });

  it("classifies a frozen driver error", () => {
    const error = Object.freeze(poolClosed());

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
  });
});

describe("classifier and detail reader agree about one incident", () => {
  it("reports the same SQLSTATE from both helpers when the wrapper carries its own errno", () => {
    const error = Object.assign(
      wrappedQueryFailure(postgresError("too many connections for role \"keeper\"", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "53300",
      })),
      { errno: "23505" },
    );

    const classification = classifyDatabaseError(error);
    const details = getDatabaseErrorDetails(error);

    expect(classification).toEqual({ slug: "db-connection-unavailable", sqlState: "53300" });
    expect(details?.sqlState).toBe(classification?.sqlState);
    expect(details?.message).toBe("too many connections for role \"keeper\"");
  });

  it("describes the server failure rather than the wrapper when the wrapper carries an errno", () => {
    const error = Object.assign(
      wrappedQueryFailure(postgresError("terminating connection due to administrator command", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57P01",
      })),
      { errno: "ECONNRESET" },
    );

    expect(getDatabaseErrorDetails(error)?.message)
      .toBe("terminating connection due to administrator command");
  });

  it("keeps repeated classification of one incident stable across many calls", () => {
    const error = wrappedQueryFailure(adminShutdown());
    const answers = Array.from({ length: 50 }, () => JSON.stringify({
      classification: classifyDatabaseError(error),
      details: getDatabaseErrorDetails(error),
    }));

    expect(new Set(answers).size).toBe(1);
  });

  it("classifies every error of one incident identically when the wrappers differ", () => {
    const cause = adminShutdown();
    const shapes = [
      cause,
      wrappedQueryFailure(cause),
      wrapWithCause("flush failed", wrappedQueryFailure(cause)),
      new AggregateError([wrappedQueryFailure(cause)], "ingest failed"),
    ];

    const slugs = shapes.map((error) => classifyDatabaseError(error)?.slug);

    expect(new Set(slugs)).toEqual(new Set(["db-connection-unavailable"]));
  });
});
