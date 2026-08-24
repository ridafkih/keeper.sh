import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    errorFields: (_error: unknown, next: Record<string, unknown>) => {
      fields = { ...fields, ...next };
    },
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

const { handlePostIcsSourceRoute } = await import("@/routes/api/ics/source-routes");

class TestInvalidSourceUrlError extends Error {
  public readonly authRequired = false;
}

const pooledInsertFailure = (driverFields: Record<string, unknown>): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"ics_sources\" (\"id\", \"user_id\") values ($1, $2)",
    ["source-1", "user-1"],
    Object.assign(new Error("Connection closed"), { name: "PostgresError" }, driverFields),
  );

const post = async (createSource: () => Promise<unknown>): Promise<Response> =>
  await handlePostIcsSourceRoute(
    { body: { name: "Team", url: "https://example.com/team.ics" }, userId: "user-1" },
    {
      createSource,
      isInvalidSourceUrlError: (_error): _error is TestInvalidSourceUrlError => false,
      isSourceLimitError: () => false,
      parseCreateSourceBody: () => ({ name: "Team", url: "https://example.com/team.ics" }),
    },
  );

describe("handlePostIcsSourceRoute under a Postgres pool failure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
  });

  it("creates the source when the pool is healthy", async () => {
    const response = await post(() => Promise.resolve({ id: "source-1" }));

    expect(response.status).toBe(201);
    expect(fields.slug).toBeUndefined();
  });

  it("labels a closed pooled connection as a database failure", async () => {
    const response = await post(() =>
      Promise.reject(pooledInsertFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" })),
    );

    expect(fields.slug).toBe("db-connection-unavailable");
    expect(response.status).toBe(500);
  });

  it("records the SQLSTATE when the server terminated the connection", async () => {
    await post(() =>
      Promise.reject(
        pooledInsertFailure({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01" }),
      ),
    );

    expect(values["db.error_sqlstate"]).toBe("57P01");
  });

  it("does not leak the failing SQL statement to the caller", async () => {
    const response = await post(() =>
      Promise.reject(pooledInsertFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" })),
    );
    const body = (await response.json()) as { error?: string };

    expect(body.error ?? "").not.toContain("insert into");
  });

  it("still answers an unparseable body with 400", async () => {
    const response = await handlePostIcsSourceRoute(
      { body: {}, userId: "user-1" },
      {
        createSource: () => Promise.resolve({ id: "source-1" }),
        isInvalidSourceUrlError: (_error): _error is TestInvalidSourceUrlError => false,
        isSourceLimitError: () => false,
        parseCreateSourceBody: () => {
          throw new Error("Name and URL are required");
        },
      },
    );

    expect(response.status).toBe(400);
  });
});
