import { describe, expect, it } from "vitest";
import { classifyDatabaseError } from "../../src/utils/errors";

describe("classifyDatabaseError sqlstate boundaries", () => {
  it("keeps the statement timeout classification ahead of the authorization class", () => {
    const cause = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "28000",
      errno: "57014",
    });

    expect(classifyDatabaseError(new Error("Failed query", { cause }))).toEqual({
      slug: "db-statement-timeout",
      sqlState: "57014",
    });
  });

  it("ignores sqlstate-shaped values of the wrong length", () => {
    for (const sqlState of ["28", "2800", "280001"]) {
      expect(classifyDatabaseError(Object.assign(new Error("x"), { code: sqlState }))).toBeNull();
    }
  });

  it("ignores a numeric errno that cannot be a sqlstate string", () => {
    expect(classifyDatabaseError(Object.assign(new Error("x"), { errno: 28_000 }))).toBeNull();
  });

  it("does not treat a lowercase five-character code as an authorization sqlstate", () => {
    expect(classifyDatabaseError(Object.assign(new Error("x"), { code: "28p01" }))).toBeNull();
  });

  it("returns the same classification on repeated runs", () => {
    const error = Object.assign(new Error('password authentication failed for user "keeper"'), {
      errno: "28P01",
      name: "PostgresError",
    });

    const runs = Array.from({ length: 4 }, () => classifyDatabaseError(error));

    expect(runs).toEqual(Array.from({ length: 4 }, () => ({
      slug: "db-connection-unavailable",
      sqlState: "28P01",
    })));
  });
});
