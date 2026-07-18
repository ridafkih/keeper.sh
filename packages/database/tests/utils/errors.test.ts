import { describe, expect, it } from "vitest";
import { getDatabaseErrorDetails } from "../../src/utils/errors";

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
});
