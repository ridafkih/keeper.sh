import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};
let createCalDAVSourceResult: () => Promise<unknown> = () =>
  Promise.resolve({ reconnected: false, source: { id: "source-1" } });

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
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

const USERNAME = "rida@fastmail.com";
const SERVER_URL = "https://caldav.fastmail.com";

const INSERT_SQL =
  'insert into "calendar_accounts" ("id", "user_id", "username", "server_url", "encrypted_password") '
  + "values ($1, $2, $3, $4, $5) returning \"id\"";

const serverError = (
  message: string,
  driverFields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, driverFields);

const queryFailure = (
  message: string,
  driverFields: Record<string, unknown>,
): DrizzleQueryError =>
  new DrizzleQueryError(
    INSERT_SQL,
    ["account-1", "user-1", USERNAME, SERVER_URL, "nacl:9f0c2a"],
    serverError(message, driverFields),
  );

const createRequest = (): Request =>
  new Request("https://api.keeper.sh/api/sources/caldav", {
    body: JSON.stringify({
      authMethod: "basic",
      calendarUrl: "https://caldav.fastmail.com/dav/calendars/user/a/work",
      name: "Work",
      password: "secret",
      provider: "fastmail",
      serverUrl: SERVER_URL,
      username: USERNAME,
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

const readBody = async (response: Response): Promise<string> => await response.text();

const SERVER_SIDE_FAILURES: [string, string, string][] = [
  ["deadlock_detected", "40P01", "deadlock detected"],
  ["serialization_failure", "40001", "could not serialize access due to concurrent update"],
  ["not_null_violation", "23502", 'null value in column "external_calendar_id" violates not-null constraint'],
  ["string_data_right_truncation", "22001", "value too long for type character varying(255)"],
  ["disk_full", "53100", "could not extend file: No space left on device"],
  ["undefined_table", "42P01", 'relation "calendar_accounts" does not exist'],
];

describe("POST /api/sources/caldav under a Postgres server-side query failure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
    createCalDAVSourceResult = () => Promise.resolve({ reconnected: false, source: { id: "source-1" } });
  });

  it.each(SERVER_SIDE_FAILURES)(
    "never blames CalDAV for %s (%s)",
    async (_name, sqlState, message) => {
      createCalDAVSourceResult = () => Promise.reject(queryFailure(message, {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: sqlState,
      }));

      await post();

      expect(fields.slug).not.toBe("caldav-connection-failed");
    },
  );

  it.each(SERVER_SIDE_FAILURES)(
    "does not leak the failing SQL or bound params for %s (%s)",
    async (_name, sqlState, message) => {
      createCalDAVSourceResult = () => Promise.reject(queryFailure(message, {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: sqlState,
      }));

      const body = await readBody(await post());

      expect(body).not.toContain("insert into");
      expect(body).not.toContain(USERNAME);
      expect(body).not.toContain(SERVER_URL);
      expect(body).not.toContain("params:");
    },
  );

  it.each(SERVER_SIDE_FAILURES)(
    "does not answer %s (%s) with 400 Bad Request",
    async (_name, sqlState, message) => {
      createCalDAVSourceResult = () => Promise.reject(queryFailure(message, {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: sqlState,
      }));

      const response = await post();

      expect(response.status).not.toBe(400);
    },
  );

  it("records the SQLSTATE of a server-side query failure", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(queryFailure("deadlock detected", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }));

    await post();

    expect(values["db.error_sqlstate"]).toBe("40P01");
  });

  it("converges on the same label and status across repeated attempts", async () => {
    createCalDAVSourceResult = () =>
      Promise.reject(queryFailure("deadlock detected", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }));

    const observed: string[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      fields = {};
      const response = await post();
      observed.push(`${String(fields.slug)}:${response.status}`);
    }

    expect(new Set(observed).size).toBe(1);
    expect(observed[0]).not.toContain("caldav-connection-failed");
  });

  it("still returns 400 with a validation message for a genuinely invalid body", async () => {
    const response = await postRoute({
      params: {},
      request: new Request("https://api.keeper.sh/api/sources/caldav", {
        body: JSON.stringify({ name: "Work" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    });

    expect(response.status).toBe(400);
  });
});
