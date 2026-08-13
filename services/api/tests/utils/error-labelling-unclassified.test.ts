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

const { labelFailure, labelFailureResponse } = await import("@/utils/error-labelling");

const serverQueryFailure = (
  message: string,
  driverFields: Record<string, unknown>,
): DrizzleQueryError =>
  new DrizzleQueryError(
    'insert into "calendar_accounts" ("username", "server_url") values ($1, $2)',
    ["rida@fastmail.com", "https://caldav.fastmail.com"],
    Object.assign(new Error(message), { name: "PostgresError" }, driverFields),
  );

const SERVER_SIDE_SQLSTATES = [
  ["40P01", "deadlock detected"],
  ["40001", "could not serialize access due to concurrent update"],
  ["23502", "null value in column violates not-null constraint"],
  ["22001", "value too long for type character varying(255)"],
  ["53100", "could not extend file: No space left on device"],
  ["42P01", 'relation "calendar_accounts" does not exist'],
  ["23505", 'duplicate key value violates unique constraint "calendar_accounts_pkey"'],
] as const;

describe("labelFailure on a server-side Postgres query failure", () => {
  beforeEach(() => {
    fields = {};
    values = {};
  });

  it.each(SERVER_SIDE_SQLSTATES)(
    "does not leave SQLSTATE %s carrying the caller's provider slug",
    (sqlState, message) => {
      labelFailure(
        serverQueryFailure(message, { code: "ERR_POSTGRES_SERVER_ERROR", errno: sqlState }),
        { slug: "caldav-connection-failed" },
      );

      expect(fields.slug).not.toBe("caldav-connection-failed");
    },
  );

  it.each(SERVER_SIDE_SQLSTATES)("records SQLSTATE %s on the wide event", (sqlState, message) => {
    labelFailure(
      serverQueryFailure(message, { code: "ERR_POSTGRES_SERVER_ERROR", errno: sqlState }),
      { slug: "unclassified" },
    );

    expect(values["db.error_sqlstate"]).toBe(sqlState);
  });

  it("answers a server-side query failure with a database response, not the caller's fallback", () => {
    const response = labelFailureResponse(
      serverQueryFailure("deadlock detected", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }),
      { slug: "invalid-request-body" },
    );

    expect(response).not.toBeNull();
  });

  it("stays on the same label when the identical failure repeats", () => {
    const observed: unknown[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      fields = {};
      labelFailure(
        serverQueryFailure("deadlock detected", {
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "40P01",
        }),
        { slug: "caldav-connection-failed" },
      );
      observed.push(fields.slug);
    }

    expect(new Set(observed).size).toBe(1);
    expect(observed[0]).not.toBe("caldav-connection-failed");
  });
});
