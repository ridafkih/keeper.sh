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

const REDIS_HOST = "10.20.0.9";
const REDIS_PORT = 6379;

const queueConnectionFailure = (): Error =>
  Object.assign(new Error(`connect ECONNREFUSED ${REDIS_HOST}:${String(REDIS_PORT)}`), {
    address: REDIS_HOST,
    code: "ECONNREFUSED",
    errno: -61,
    port: REDIS_PORT,
    syscall: "connect",
  });

const planLookupFailure = (): Error =>
  new Error(
    `premium lookup failed: request to http://billing.internal.keeper:8080/plans/user-1 failed`,
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

describe("POST /api/sources/caldav when a non-database dependency fails", () => {
  beforeEach(() => {
    fields = {};
    values = {};
    createCalDAVSourceResult = () => Promise.resolve({ reconnected: false, source: { id: "source-1" } });
  });

  it("does not echo the queue host and port back to the caller", async () => {
    createCalDAVSourceResult = () => Promise.reject(queueConnectionFailure());

    const response = await post();
    const body = await response.text();

    expect(body).not.toContain(REDIS_HOST);
    expect(body).not.toContain(String(REDIS_PORT));
  });

  it("does not answer a queue outage with 400 Bad Request", async () => {
    createCalDAVSourceResult = () => Promise.reject(queueConnectionFailure());

    const response = await post();

    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("does not echo an internal service URL back to the caller", async () => {
    createCalDAVSourceResult = () => Promise.reject(planLookupFailure());

    const response = await post();
    const body = await response.text();

    expect(body).not.toContain("billing.internal.keeper");
  });

  it("answers the same way on every retry of the same outage", async () => {
    createCalDAVSourceResult = () => Promise.reject(queueConnectionFailure());

    const observed: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await post();
      observed.push(`${String(response.status)}:${await response.text()}`);
    }

    expect(new Set(observed).size).toBe(1);
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
