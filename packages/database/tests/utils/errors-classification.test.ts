import { describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

const POOL_CODES = [
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
] as const;

const postgresError = (message: string, fields: Record<string, unknown>): Error =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const drizzleWrapped = (cause: unknown): Error =>
  Object.assign(new Error("Failed query: select 1\nparams: "), {
    query: "select 1",
    params: [],
    cause,
  });

describe("classifyDatabaseError pool lifecycle codes", () => {
  it.each(POOL_CODES)("classifies %s raised directly by the driver", (code) => {
    expect(classifyDatabaseError(postgresError("Connection closed", { code }))).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it.each(POOL_CODES)("classifies %s once the query builder has wrapped it", (code) => {
    expect(classifyDatabaseError(drizzleWrapped(postgresError("Connection closed", { code }))))
      .toEqual({ slug: "db-connection-unavailable", sqlState: null });
  });

  it("keeps a terminated backend distinct from an unavailable pool connection", () => {
    const terminated = postgresError("Failed to read data", {
      code: "ERR_POSTGRES_EXPECTED_REQUEST",
    });

    expect(classifyDatabaseError(terminated)?.slug).toBe("db-connection-terminated");
    expect(classifyDatabaseError(drizzleWrapped(terminated))?.slug).toBe(
      "db-connection-terminated",
    );
  });

  it("prefers the statement timeout when a cancelled query rides on a dying connection", () => {
    const error = Object.assign(
      postgresError("Failed query", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
      { cause: postgresError("canceling statement", { errno: "57014" }) },
    );

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
  });

  it("returns the same classification for repeated calls on one error", () => {
    const error = drizzleWrapped(
      postgresError("Idle timeout", { code: "ERR_POSTGRES_IDLE_TIMEOUT" }),
    );

    const results = Array.from({ length: 5 }, () => classifyDatabaseError(error));

    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(results[0]?.slug).toBe("db-connection-unavailable");
  });
});

describe("classifyDatabaseError server-side connection lifecycle", () => {
  it.each([
    ["57P01", "terminating connection due to administrator command"],
    ["57P02", "terminating connection due to crash of another server process"],
    ["57P03", "the database system is starting up"],
    ["57P05", "terminating connection due to idle-session timeout"],
    ["53300", 'too many connections for role "keeper"'],
    ["08006", "connection failure"],
    ["08003", "connection does not exist"],
  ])("classifies SQLSTATE %s as a database failure", (errno, message) => {
    const error = drizzleWrapped(
      postgresError(message, { code: "ERR_POSTGRES_SERVER_ERROR", errno }),
    );

    expect(classifyDatabaseError(error)).not.toBeNull();
  });

  it("still finds the SQLSTATE when the wrapper carries a non-SQLSTATE errno", () => {
    const error = Object.assign(drizzleWrapped(
      postgresError("terminating connection due to administrator command", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57P01",
      }),
    ), { errno: "ECONNRESET" });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("still finds the SQLSTATE when the wrapper carries an unrelated SQLSTATE", () => {
    const error = Object.assign(drizzleWrapped(
      postgresError("too many connections for role \"keeper\"", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "53300",
      }),
    ), { errno: "23505" });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "53300",
    });
  });

  it("still finds a cancelled statement behind a wrapper errno", () => {
    const error = Object.assign(drizzleWrapped(
      postgresError("canceling statement due to statement timeout", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "57014",
      }),
    ), { errno: "ECONNRESET" });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
  });
});

describe("classifyDatabaseError non-database failures", () => {
  it.each([
    ["a provider fetch failure", new TypeError("fetch failed")],
    ["a plain provider error", new Error("Google returned 500")],
    ["an abort timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
    ["a socket reset", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["an HTTP status error", Object.assign(new Error("forbidden"), { status: 403 })],
    ["a lookalike code", postgresError("nope", { code: "ERR_POSTGRES_SERVER_ERROR" })],
    ["a truncated code", postgresError("nope", { code: "ERR_POSTGRES_CONNECTION" })],
    ["a lowercase code", postgresError("nope", { code: "err_postgres_idle_timeout" })],
  ])("leaves %s unclassified", (_label, error) => {
    expect(classifyDatabaseError(error)).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", Reflect.get({}, "missing")],
    ["a string", "Connection closed"],
    ["a number", 57_014],
    ["an empty object", {}],
    ["a null cause", { cause: null }],
    ["a string cause", { cause: "ERR_POSTGRES_IDLE_TIMEOUT" }],
    ["an empty code", { code: "" }],
    ["a numeric code", { code: 57_014 }],
  ])("tolerates %s without throwing", (_label, error) => {
    expect(classifyDatabaseError(error)).toBeNull();
  });

  it("does not read a driver code through a DOMException numeric code", () => {
    const abort = new DOMException("The operation timed out.", "TimeoutError");

    expect(abort.code).toBeTypeOf("number");
    expect(classifyDatabaseError(abort)).toBeNull();
  });
});

describe("getDatabaseErrorDetails alongside classification", () => {
  it("describes a wrapped pool failure without inventing a sqlState", () => {
    const error = drizzleWrapped(
      postgresError("Max lifetime timeout reached after 1800s", {
        code: "ERR_POSTGRES_LIFETIME_TIMEOUT",
      }),
    );

    expect(getDatabaseErrorDetails(error)).toEqual({
      constraint: null,
      detail: null,
      message: "Max lifetime timeout reached after 1800s",
      sqlState: null,
    });
    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });
});
