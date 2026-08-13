import { getDatabaseErrorDetails } from "@keeper.sh/database";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "../../src/utils/provider-ingest-failure";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const insertEventStates = (params: unknown[], cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"event_states\" (\"id\", \"source_event_uid\", \"title\") values ($1, $2, $3)",
    params,
    cause,
  );

const valueTooLong = (): Error & Record<string, unknown> =>
  postgresError("value too long for type character varying(512)", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "22001",
  });

const uniqueViolation = (): Error & Record<string, unknown> =>
  postgresError("duplicate key value violates unique constraint \"event_states_pkey\"", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    constraint: "event_states_pkey",
    detail: "Key (id)=(evt-3) already exists.",
    errno: "23505",
  });

const untranslatableCharacter = (): Error & Record<string, unknown> =>
  postgresError("invalid byte sequence for encoding \"UTF8\": 0x00", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "22021",
  });

const deadlock = (): Error & Record<string, unknown> =>
  postgresError("deadlock detected", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "40P01",
  });

const tlsUnavailable = (): Error & Record<string, unknown> =>
  postgresError("Server does not support SSL", { code: "ERR_POSTGRES_TLS_NOT_AVAILABLE" });

const DATABASE_FAILURES: [string, Error & Record<string, unknown>][] = [
  ["22001 value too long", valueTooLong()],
  ["23505 unique violation", uniqueViolation()],
  ["22021 untranslatable character", untranslatableCharacter()],
  ["40P01 deadlock", deadlock()],
  ["driver refused to negotiate TLS", tlsUnavailable()],
];

describe("a database failure whose bound parameters happen to contain 404", () => {
  it.each(DATABASE_FAILURES)(
    "does not report %s as a missing provider calendar",
    (_label, cause) => {
      const error = insertEventStates(
        ["evt-1", "a404b0c1d2e3f4a5b6c7d8e9@google.com", "Standup"],
        cause,
      );

      expect(error.message).toContain("404");
      expect(getDatabaseErrorDetails(error)).not.toBeNull();
      expect(resolveMissingCalendarFailure(error)).toBeNull();
    },
  );

  it("does not read a 404 out of a bulk insert carrying hundreds of provider uids", () => {
    const uids = Array.from({ length: 500 }, (_value, index) =>
      `${index.toString().padStart(4, "0")}aabbccddeeff@google.com`);
    const error = insertEventStates(uids, valueTooLong());

    expect(error.message).toContain("404");
    expect(resolveMissingCalendarFailure(error)).toBeNull();
  });

  it("does not read a 404 out of an ICS feed url embedded in the failing row", () => {
    const error = insertEventStates(
      ["evt-9", "https://calendar.example.com/feeds/404-team-offsite.ics", "Offsite"],
      untranslatableCharacter(),
    );

    expect(resolveMissingCalendarFailure(error)).toBeNull();
  });

  it("gives the same answer on every retry of the same failing insert", () => {
    const error = insertEventStates(["evt-404", "uid-1", "Standup"], uniqueViolation());
    const answers = Array.from({ length: 5 }, () =>
      JSON.stringify(resolveMissingCalendarFailure(error)));

    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe("null");
  });

  it("still reports a genuine provider 404 as a missing calendar", () => {
    expect(resolveMissingCalendarFailure(new Error("Collection query failed: 404 Not Found")))
      .toEqual({ disableCalendar: false, retriable: true, slug: "provider-calendar-not-found" });

    expect(resolveMissingCalendarFailure(Object.assign(new Error("Not Found"), { status: 404 })))
      .toEqual({ disableCalendar: false, retriable: true, slug: "provider-calendar-not-found" });
  });

  it("still reports a provider failure that a database error merely wraps nothing of", () => {
    expect(resolveMissingCalendarFailure(new Error("HTTP 500"))).toBeNull();
  });
});
