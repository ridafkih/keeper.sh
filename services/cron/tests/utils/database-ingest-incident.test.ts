import { classifyDatabaseError } from "@keeper.sh/database";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { resolveMissingCalendarFailure } from "../../src/utils/provider-ingest-failure";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const wrapped = (cause: Error, params: unknown[] = []): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"event_states\" (\"id\", \"source_event_uid\") values ($1, $2)",
    params,
    cause,
  );

const resolveSlug = (error: unknown): string =>
  resolveMissingCalendarFailure(error)?.slug
  ?? classifyDatabaseError(error)?.slug
  ?? "provider-api-error";

const INCIDENT_SHAPES = [
  wrapped(postgresError("terminating connection due to administrator command", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57P01",
  })),
  wrapped(postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" })),
  wrapped(postgresError("Failed to read data", { code: "ERR_POSTGRES_EXPECTED_REQUEST" })),
  wrapped(postgresError("Connection timed out", { code: "ERR_POSTGRES_CONNECTION_TIMEOUT" })),
];

describe("one pool incident seen by many concurrent source ingests", () => {
  it("never labels any shape of the incident as a provider failure", () => {
    const slugs = INCIDENT_SHAPES.map((error) => resolveSlug(error));

    expect(slugs.every((slug) => slug.startsWith("db-"))).toBe(true);
  });

  it("keeps a genuine provider 404 on its own slug while the pool is failing around it", () => {
    const providerFailure = Object.assign(
      new Error("Calendar query failed: 404 Not Found"),
      { status: 404 },
    );

    const batch = [
      INCIDENT_SHAPES[0],
      providerFailure,
      INCIDENT_SHAPES[1],
      providerFailure,
      INCIDENT_SHAPES[2],
    ];

    expect(batch.map((error) => resolveSlug(error))).toEqual([
      "db-connection-unavailable",
      "provider-calendar-not-found",
      "db-connection-unavailable",
      "provider-calendar-not-found",
      "db-connection-terminated",
    ]);
  });

  it("does not read a 404 out of the row values the failing insert carried", () => {
    const error = wrapped(
      postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" }),
      ["evt-404", "404@keeper.sh"],
    );

    expect(error.message).toContain("404");
    expect(resolveSlug(error)).toBe("db-connection-unavailable");
  });

  it("gives the same answer on every retry of the same failing source", () => {
    const [error] = INCIDENT_SHAPES;
    const answers = Array.from({ length: 10 }, () => resolveSlug(error));

    expect(new Set(answers).size).toBe(1);
  });

  it("stays on a provider slug once the pool has recovered and the provider is still broken", () => {
    const sequence = [
      INCIDENT_SHAPES[1],
      INCIDENT_SHAPES[1],
      Object.assign(new Error("Calendar query failed: 404 Not Found"), { status: 404 }),
    ];

    expect(sequence.map((error) => resolveSlug(error))).toEqual([
      "db-connection-unavailable",
      "db-connection-unavailable",
      "provider-calendar-not-found",
    ]);
  });
});
