import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const EVENT_UPSERT_SQL =
  'insert into "event_states" ("id", "source_event_uid", "title") values ($1, $2, $3) '
  + 'on conflict ("id") do update set "title" = excluded."title"';

const upsertFailure = (
  params: unknown[],
  cause: Error,
): DrizzleQueryError => new DrizzleQueryError(EVENT_UPSERT_SQL, params, cause);

const AUTH_TEXT_PARAMS = [
  "state-1",
  "uid-1@fastmail.com",
  "Runbook: authentication failed on the billing gateway",
];

describe("isCalDAVAuthenticationError against our own database failures", () => {
  it("does not read a deadlock on the event upsert as a CalDAV auth failure", () => {
    const error = upsertFailure(
      ["state-1", "uid-1@fastmail.com", "Standup"],
      postgresError("deadlock detected", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }),
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("does not read an event title mentioning authentication failed as a CalDAV auth failure", () => {
    const error = upsertFailure(
      AUTH_TEXT_PARAMS,
      postgresError("value too long for type character varying(255)", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "22001",
      }),
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("does not read an event title mentioning invalid credentials as a CalDAV auth failure", () => {
    const error = upsertFailure(
      ["state-1", "uid-1@fastmail.com", "Invalid credentials post-mortem"],
      postgresError("could not serialize access due to concurrent update", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40001",
      }),
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("does not read a lost pooled connection as a CalDAV auth failure", () => {
    const error = upsertFailure(
      AUTH_TEXT_PARAMS,
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("does not read a database failure nested two wrappers deep as a CalDAV auth failure", () => {
    const error = new Error("source ingest failed", {
      cause: new Error("transaction rolled back", {
        cause: upsertFailure(
          AUTH_TEXT_PARAMS,
          postgresError("deadlock detected", {
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "40P01",
          }),
        ),
      }),
    });

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("does not read a database failure inside an AggregateError as a CalDAV auth failure", () => {
    const error = new AggregateError(
      [
        upsertFailure(
          AUTH_TEXT_PARAMS,
          postgresError("deadlock detected", {
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "40P01",
          }),
        ),
      ],
      "ingest batch failed",
    );

    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("still reads a genuine CalDAV 401 as an auth failure", () => {
    expect(
      isCalDAVAuthenticationError(Object.assign(new Error("Unauthorized"), { status: 401 })),
    ).toBe(true);
  });

  it("returns the same verdict on every repeated evaluation of one incident", () => {
    const verdicts = Array.from({ length: 3 }, () =>
      isCalDAVAuthenticationError(
        upsertFailure(
          AUTH_TEXT_PARAMS,
          postgresError("deadlock detected", {
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "40P01",
          }),
        ),
      ));

    expect(verdicts).toEqual([false, false, false]);
  });
});
