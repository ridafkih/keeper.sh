import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};
let createCalDAVSourceResult: () => Promise<unknown> = () =>
  Promise.resolve({ id: "source-1" });

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    error: () => null,
    errorFields: (_error: unknown, next: Record<string, unknown>) => {
      fields = { ...fields, ...next };
    },
    flush: () => null,
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

vi.mock("@/utils/middleware", () => ({
  withAuth:
    (handler: (ctx: Record<string, unknown>) => unknown) =>
    (ctx: Record<string, unknown>) =>
      handler({ ...ctx, userId: "user-1" }),
  withWideEvent: (handler: unknown) => handler,
}));

class TestCalDAVSourceLimitError extends Error {}
class TestDuplicateCalDAVSourceError extends Error {}

vi.mock("@/utils/caldav-sources", () => ({
  CalDAVSourceLimitError: TestCalDAVSourceLimitError,
  DuplicateCalDAVSourceError: TestDuplicateCalDAVSourceError,
  createCalDAVSource: () => createCalDAVSourceResult(),
  getUserCalDAVSources: () => Promise.resolve([]),
}));

const { POST } = await import("@/routes/api/sources/caldav/index");

const postgresError = (
  message: string,
  driverFields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, driverFields);

const pooledInsertFailure = (driverFields: Record<string, unknown>): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"calendar_sources\" (\"id\", \"user_id\") values ($1, $2)",
    ["source-1", "user-1"],
    postgresError("Connection closed", driverFields),
  );

const createRequest = (): Request =>
  new Request("https://api.keeper.sh/api/sources/caldav", {
    body: JSON.stringify({
      authMethod: "basic",
      calendarUrl: "https://caldav.fastmail.com/dav/calendars/user/a/work",
      name: "Work",
      password: "secret",
      provider: "fastmail",
      serverUrl: "https://caldav.fastmail.com",
      username: "user@fastmail.com",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

const postRoute = POST as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const post = async (): Promise<Response> =>
  await postRoute({ params: {}, request: createRequest() });

describe("POST /api/sources/caldav under a Postgres pool failure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
    createCalDAVSourceResult = () => Promise.resolve({ id: "source-1" });
  });

  it("creates the source when the pool is healthy", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    expect(fields.slug).toBeUndefined();
  });

  it("labels a closed pooled connection as a database failure, not a CalDAV connection failure", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(pooledInsertFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" }));

    await post();

    expect(fields.slug).toBe("db-connection-unavailable");
  });

  it("records the SQLSTATE when the server terminated the connection", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(
        pooledInsertFailure({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "57P01" }),
      );

    await post();

    expect(values["db.error_sqlstate"]).toBe("57P01");
    expect(fields.slug).toBe("db-connection-unavailable");
  });

  it("does not answer a pool outage with 400 Bad Request", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(pooledInsertFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" }));

    const response = await post();

    expect(response.status).not.toBe(400);
  });

  it("does not leak the failing SQL statement to the caller", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(pooledInsertFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" }));

    const response = await post();
    const body = (await response.json()) as { error?: string };

    expect(body.error ?? "").not.toContain("insert into");
  });

  it("still labels a genuine CalDAV failure with the provider slug", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(new Error("CalDAV server responded 401 Unauthorized"));

    await post();

    expect(fields.slug).toBe("caldav-connection-failed");
  });
});
