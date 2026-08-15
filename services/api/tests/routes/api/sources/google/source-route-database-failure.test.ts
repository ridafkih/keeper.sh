import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

let fields: Record<string, unknown> = {};
let values: Record<string, unknown> = {};
let createOAuthSourceResult: () => Promise<unknown> = () =>
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

class TestOAuthSourceLimitError extends Error {}
class TestDestinationNotFoundError extends Error {}
class TestDestinationProviderMismatchError extends Error {}
class TestDuplicateSourceError extends Error {}

vi.mock("@/utils/oauth-sources", () => ({
  DestinationNotFoundError: TestDestinationNotFoundError,
  DestinationProviderMismatchError: TestDestinationProviderMismatchError,
  DuplicateSourceError: TestDuplicateSourceError,
  OAuthSourceLimitError: TestOAuthSourceLimitError,
  createOAuthSource: () => createOAuthSourceResult(),
  getUserOAuthSources: () => Promise.resolve([]),
}));

vi.mock("@/context", () => ({
  premiumService: { canUseEventFilters: () => Promise.resolve(true) },
}));

const { POST } = await import("@/routes/api/sources/google/index");

const pooledInsertFailure = (): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"calendar_sources\" (\"id\", \"user_id\") values ($1, $2)",
    ["source-1", "user-1"],
    Object.assign(new Error("Connection closed"), {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
      name: "PostgresError",
    }),
  );

const createRequest = (): Request =>
  new Request("https://api.keeper.sh/api/sources/google", {
    body: JSON.stringify({
      externalCalendarId: "primary",
      name: "Work",
      oauthSourceCredentialId: "cred-1",
      syncFocusTime: true,
      syncOutOfOffice: true,
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

describe("POST /api/sources/google under a Postgres pool failure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
    createOAuthSourceResult = () => Promise.resolve({ id: "source-1" });
  });

  it("creates the source when the pool is healthy", async () => {
    const response = await post();

    expect(response.status).toBe(201);
  });

  it("labels a closed pooled connection as a database failure", async () => {
    createOAuthSourceResult = () => Promise.reject(pooledInsertFailure());

    await post();

    expect(fields.slug).toBe("db-connection-unavailable");
  });

  it("does not answer a pool outage with 400 Invalid request body", async () => {
    createOAuthSourceResult = () => Promise.reject(pooledInsertFailure());

    const response = await post();

    expect(response.status).not.toBe(400);
  });
});
