import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { classifyDatabaseError } from "../../src/utils/errors";

const serverError = (
  message: string,
  errno: string,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), {
    name: "PostgresError",
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno,
  } as Record<string, unknown>);

const wrapped = (cause: Error): DrizzleQueryError =>
  new DrizzleQueryError("select \"id\" from \"calendars\"", [], cause);

const ESTABLISHMENT_FAILURES = [
  {
    errno: "28P01",
    label: "the pool credentials were rotated out from under us",
    message: "password authentication failed for user \"keeper_app\"",
  },
  {
    errno: "28000",
    label: "pg_hba rejects the pool host",
    message: "no pg_hba.conf entry for host \"10.0.4.11\"",
  },
  {
    errno: "3D000",
    label: "the configured database is gone",
    message: "database \"keeper\" does not exist",
  },
] as const;

describe("connection-establishment failures raised by our own pool", () => {
  it.each(ESTABLISHMENT_FAILURES)(
    "classifies $errno as a database failure when $label",
    ({ errno, message }) => {
      expect(classifyDatabaseError(wrapped(serverError(message, errno)))?.slug)
        .toBe("db-connection-unavailable");
    },
  );

  it("keeps an ordinary constraint violation out of the connection family", () => {
    const error = wrapped(serverError(
      "duplicate key value violates unique constraint \"event_states_pkey\"",
      "23505",
    ));

    expect(classifyDatabaseError(error)).toBeNull();
  });
});
