import { describe, expect, it } from "vitest";
import {
  classifyDatabaseError,
  getDatabaseErrorDetails,
  isDatabaseError,
  resolveDatabaseErrorClassification,
} from "../../src/utils/errors";

const withFields = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> => Object.assign(new Error(message), fields);

describe("errors that are not ours", () => {
  it("does not read a numeric errno as a sqlstate", () => {
    const socketFailure = withFields("Failed to connect", {
      code: "ECONNREFUSED",
      errno: -61,
      syscall: "connect",
    });

    expect(isDatabaseError(socketFailure)).toBe(false);
    expect(classifyDatabaseError(socketFailure)).toBeNull();
    expect(getDatabaseErrorDetails(socketFailure)).toBeNull();
  });

  it("does not claim a provider fetch failure as a database failure", () => {
    const fetchFailure = withFields(
      "Unable to connect. Is the computer able to access the url?",
      { code: "ConnectionRefused", errno: 0 },
    );

    expect(isDatabaseError(fetchFailure)).toBe(false);
    expect(classifyDatabaseError(fetchFailure)).toBeNull();
  });

  it("does not treat a five-letter posix code carried as a string errno as a sqlstate slug", () => {
    const brokenPipe = withFields("write EPIPE", { code: "EPIPE", errno: "EPIPE" });

    expect(classifyDatabaseError(brokenPipe)).toBeNull();
    expect(isDatabaseError(brokenPipe)).toBe(false);
    expect(resolveDatabaseErrorClassification(brokenPipe)).toBeNull();
    expect(getDatabaseErrorDetails(brokenPipe)).toBeNull();
  });

  it.each(["EPERM", "EBUSY", "EROFS", "ENOSR"])(
    "does not read %s as a sqlstate",
    (code) => {
      const failure = withFields(`socket ${code}`, { code, errno: code });

      expect(isDatabaseError(failure)).toBe(false);
      expect(resolveDatabaseErrorClassification(failure)).toBeNull();
    },
  );

  it("still reads a real sqlstate whose class is alphabetic", () => {
    const undefinedDatabase = withFields("database \"keeper\" does not exist", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "3D000",
      name: "PostgresError",
    });

    expect(resolveDatabaseErrorClassification(undefinedDatabase)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "3D000",
    });
  });

  it("returns null for an aggregate of provider failures only", () => {
    const aggregate = new AggregateError(
      [withFields("429 Too Many Requests", { status: 429 }), new Error("404 Not Found")],
      "provider batch failed",
    );

    expect(classifyDatabaseError(aggregate)).toBeNull();
    expect(isDatabaseError(aggregate)).toBe(false);
  });

  it("returns null for an empty aggregate", () => {
    expect(classifyDatabaseError(new AggregateError([], "nothing failed"))).toBeNull();
  });
});

describe("chains that fight back", () => {
  it("terminates on a cause cycle", () => {
    const outer = new Error("outer");
    const inner = withFields("Connection closed", {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    });
    outer.cause = inner;
    inner.cause = outer;

    expect(classifyDatabaseError(outer)?.slug).toBe("db-connection-unavailable");
  });

  it("terminates when an aggregate member is the aggregate itself", () => {
    const members: unknown[] = [];
    const aggregate = new AggregateError(members, "self referential");
    members.push(aggregate);

    expect(classifyDatabaseError(aggregate)).toBeNull();
  });

  it("finds a pool failure buried under four wrappers", () => {
    const pool = withFields("Connection closed", {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    });
    let chain: Error = pool;
    for (const level of [1, 2, 3, 4]) {
      chain = withFields(`wrapper ${level}`, { cause: chain });
    }

    expect(classifyDatabaseError(chain)?.slug).toBe("db-connection-unavailable");
  });
});

describe("a pool failure whose message reads like a provider auth failure", () => {
  const poolAuthFailure = withFields("password authentication failed for user \"keeper\"", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "28P01",
    name: "PostgresError",
  });

  it("classifies as a database failure", () => {
    expect(classifyDatabaseError(poolAuthFailure)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "28P01",
    });
  });

  it("reports the same sqlstate through the detail helper", () => {
    expect(getDatabaseErrorDetails(poolAuthFailure)?.sqlState).toBe("28P01");
  });

  it("is recognised as a database error through the shared predicate", () => {
    expect(isDatabaseError(new Error("ingest failed", { cause: poolAuthFailure }))).toBe(true);
  });
});
