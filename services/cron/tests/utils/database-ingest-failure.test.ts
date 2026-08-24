import { classifyDatabaseError } from "@keeper.sh/database";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "../../src/utils/provider-ingest-failure";

const postgresError = (
  fields: Record<string, unknown> & { message: string },
): Error & Record<string, unknown> => {
  const { message, ...rest } = fields;
  return Object.assign(new Error(message), rest);
};

const wrappedQueryFailure = (params: unknown[], cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"events\" (\"id\", \"uid\", \"url\") values ($1, $2, $3)",
    params,
    cause,
  );

const POOL_FAILURES: { label: string; cause: Error }[] = [
  {
    label: "backend terminated by an administrator",
    cause: postgresError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "57P01",
      message: "terminating connection due to administrator command",
    }),
  },
  {
    label: "pooled connection closed",
    cause: postgresError({
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
      message: "Connection closed",
    }),
  },
  {
    label: "role connection limit reached",
    cause: postgresError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "53300",
      message: "too many connections for role \"keeper_app\"",
    }),
  },
];

describe("ingest failure precedence between the database classifier and the missing-calendar heuristic", () => {
  it.each(POOL_FAILURES)(
    "does not attribute a $label to a missing provider calendar when a query parameter contains 404",
    ({ cause }) => {
      const error = wrappedQueryFailure(
        ["evt-1", "20260404T090000Z-9f3@keeper.sh", "https://caldav.example.com/cal/404abc/"],
        cause,
      );

      expect(error.message).toContain("404");
      expect(classifyDatabaseError(error)).not.toBeNull();
      expect(resolveMissingCalendarFailure(error)).toBeNull();
    },
  );

  it("keeps one pool incident on one slug regardless of the parameters of the failed query", () => {
    const cause = postgresError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "57P01",
      message: "terminating connection due to administrator command",
    });

    const withMatchingParams = wrappedQueryFailure(
      ["evt-1", "uid-404-a", "https://ics.example.com/feed404.ics"],
      cause,
    );
    const withPlainParams = wrappedQueryFailure(
      ["evt-2", "uid-plain-b", "https://ics.example.com/feed.ics"],
      cause,
    );

    const slugs = [withMatchingParams, withPlainParams].map((error) =>
      resolveMissingCalendarFailure(error)?.slug ?? classifyDatabaseError(error)?.slug ?? "provider-api-error",
    );

    expect(new Set(slugs).size).toBe(1);
    expect(slugs).toEqual(["db-connection-unavailable", "db-connection-unavailable"]);
  });

  it("still recognises a genuine provider 404 that carries no database markers", () => {
    const error = new Error("Collection query failed: 404 Not Found");

    expect(classifyDatabaseError(error)).toBeNull();
    expect(resolveMissingCalendarFailure(error)).toEqual({
      disableCalendar: false,
      retriable: true,
      slug: "provider-calendar-not-found",
    });
  });

  it("returns the same answer however many times the same failure is re-classified", () => {
    const error = wrappedQueryFailure(
      ["evt-1", "uid-404", "https://caldav.example.com/404/"],
      postgresError({ code: "ERR_POSTGRES_IDLE_TIMEOUT", message: "Idle timeout reached" }),
    );

    const answers = Array.from({ length: 4 }, () => ({
      classified: classifyDatabaseError(error),
      missing: resolveMissingCalendarFailure(error),
    }));

    for (const answer of answers) {
      expect(answer.classified).toEqual({ slug: "db-connection-unavailable", sqlState: null });
      expect(answer.missing).toBeNull();
    }
  });
});
