import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<void>) => await run(),
  widelog: {
    errorFields: (_error: unknown, next: Record<string, unknown>) => {
      fields = { ...fields, ...next };
    },
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

const { labelFailure } = await import("@/utils/error-labelling");

const pooledQueryFailure = (driverFields: Record<string, unknown>): DrizzleQueryError =>
  new DrizzleQueryError(
    "select \"id\" from \"calendar_sources\"",
    [],
    Object.assign(new Error("Connection closed"), { name: "PostgresError" }, driverFields),
  );

describe("labelFailure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
  });

  it("labels a closed pooled connection wrapped by the ORM as a database failure", () => {
    labelFailure(pooledQueryFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" }), {
      slug: "unclassified",
    });

    expect(fields.slug).toBe("db-connection-unavailable");
  });

  it("records the SQLSTATE when the server terminated the connection", () => {
    labelFailure(
      pooledQueryFailure({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01" }),
      { slug: "unclassified" },
    );

    expect(values["db.error_sqlstate"]).toBe("57P01");
    expect(fields.slug).toBe("db-connection-unavailable");
  });

  it("keeps the caller's fallback slug and extra fields for a non-database failure", () => {
    labelFailure(new Error("redis: connection refused"), {
      retriable: false,
      slug: "unclassified",
    });

    expect(fields.slug).toBe("unclassified");
    expect(fields.retriable).toBe(false);
    expect(values["db.error_sqlstate"]).toBeUndefined();
  });
});
