import { describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

describe("getDatabaseErrorDetails", () => {
  it("extracts PostgreSQL diagnostics from a wrapped query error", () => {
    const cause = Object.assign(new Error("duplicate key"), {
      constraint: "event_mappings_sync_event_cal_idx",
      detail: "Key already exists.",
      errno: "23505",
    });

    expect(getDatabaseErrorDetails(new Error("Failed query", { cause }))).toEqual({
      constraint: "event_mappings_sync_event_cal_idx",
      detail: "Key already exists.",
      message: "duplicate key",
      sqlState: "23505",
    });
  });

  it("returns null when an error has no database cause", () => {
    expect(getDatabaseErrorDetails(new Error("network failed"))).toBeNull();
  });

  it("classifies a connection termination wrapped by the query builder", () => {
    const cause = Object.assign(new Error("connection terminated"), {
      code: "ERR_POSTGRES_EXPECTED_REQUEST",
    });

    expect(classifyDatabaseError(new Error("Failed query", { cause }))).toEqual({
      slug: "db-connection-terminated",
      sqlState: null,
    });
  });

  it("classifies a pool connection closed by the driver", () => {
    const error = Object.assign(new Error("Connection closed"), {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
      name: "PostgresError",
    });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("classifies an idle connection timeout wrapped by the query builder", () => {
    const cause = Object.assign(new Error("Idle timeout reached after 30s"), {
      code: "ERR_POSTGRES_IDLE_TIMEOUT",
      name: "PostgresError",
    });

    expect(classifyDatabaseError(new Error("Failed query", { cause }))).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("classifies a connection that never established within the timeout", () => {
    const error = Object.assign(new Error("Connection timeout after 30s"), {
      code: "ERR_POSTGRES_CONNECTION_TIMEOUT",
      name: "PostgresError",
    });

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: null,
    });
  });

  it("leaves a server-side constraint violation unclassified", () => {
    const cause = Object.assign(new Error("duplicate key"), { errno: "23505" });

    expect(classifyDatabaseError(new Error("Failed query", { cause }))).toBeNull();
  });
});
