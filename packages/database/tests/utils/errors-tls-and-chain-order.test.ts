import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { classifyDatabaseError, getDatabaseErrorDetails } from "../../src/utils/errors";

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const wrapped = (cause: unknown): DrizzleQueryError =>
  new DrizzleQueryError("select 1", [], cause as Error);

const tlsNotAvailable = (): DrizzleQueryError =>
  wrapped(postgresError("Server does not support SSL", {
    code: "ERR_POSTGRES_TLS_NOT_AVAILABLE",
  }));

const tlsUpgradeFailed = (): DrizzleQueryError =>
  wrapped(postgresError("TLS upgrade failed", {
    code: "ERR_POSTGRES_TLS_UPGRADE_FAILED",
  }));

const adminShutdown = (): Error & Record<string, unknown> =>
  postgresError("terminating connection due to administrator command", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "57P01",
  });

const tooManyConnections = (): Error & Record<string, unknown> =>
  postgresError("too many connections for role \"keeper\"", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "53300",
  });

const poolClosed = (): Error & Record<string, unknown> =>
  postgresError("Connection closed", { code: "ERR_POSTGRES_CONNECTION_CLOSED" });

const uniqueViolation = (): Error & Record<string, unknown> =>
  postgresError("duplicate key value violates unique constraint \"event_states_pkey\"", {
    code: "ERR_POSTGRES_SERVER_ERROR",
    constraint: "event_states_pkey",
    detail: "Key (id)=(evt-3) already exists.",
    errno: "23505",
  });

describe("a pool that cannot negotiate TLS with the server", () => {
  it("classifies a server that refuses the SSL request as a database failure", () => {
    expect(classifyDatabaseError(tlsNotAvailable())?.slug).toMatch(/^db-/);
  });

  it("classifies a failed TLS upgrade as a database failure", () => {
    expect(classifyDatabaseError(tlsUpgradeFailed())?.slug).toMatch(/^db-/);
  });

  it("classifies a rejected credential and a rejected TLS handshake the same way", () => {
    const rejectedCredential = wrapped(postgresError(
      "password authentication failed for user \"keeper\"",
      { code: "ERR_POSTGRES_SERVER_ERROR", errno: "28P01" },
    ));

    expect(classifyDatabaseError(rejectedCredential)?.slug).toBe("db-connection-unavailable");
    expect(classifyDatabaseError(tlsNotAvailable())?.slug)
      .toBe(classifyDatabaseError(rejectedCredential)?.slug);
  });
});

describe("classification of the chain the running services actually build", () => {
  it("finds the pool failure through the job aggregate, the source wrapper and the query builder", () => {
    const error = new AggregateError(
      [new Error("ingesting a source failed", { cause: wrapped(adminShutdown()) })],
      "Calendar source ingestion completed with failures",
    );

    expect(classifyDatabaseError(error)).toEqual({
      slug: "db-connection-unavailable",
      sqlState: "57P01",
    });
  });

  it("classifies one incident identically however the aggregate members are ordered", () => {
    const members = [
      wrapped(adminShutdown()),
      wrapped(tooManyConnections()),
      wrapped(poolClosed()),
    ];
    const orderings = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
    ];

    const slugs = orderings.map((ordering) =>
      classifyDatabaseError(
        new AggregateError(ordering.map((index) => members[index]), "mapping mutation failed"),
      )?.slug);

    expect(new Set(slugs)).toEqual(new Set(["db-connection-unavailable"]));
  });

  it("reports a SQLSTATE that belongs to one of the aggregated failures", () => {
    const error = new AggregateError(
      [wrapped(adminShutdown()), wrapped(tooManyConnections())],
      "mapping mutation failed",
    );

    expect(["57P01", "53300"]).toContain(classifyDatabaseError(error)?.sqlState);
  });

  it("keeps the constraint violation describable when a pool failure rides beside it", () => {
    const error = new AggregateError(
      [wrapped(uniqueViolation()), wrapped(poolClosed())],
      "Mapping mutation failed and its locks could not be fully released",
    );

    expect(classifyDatabaseError(error)?.slug).toBe("db-connection-unavailable");
    expect(getDatabaseErrorDetails(error)?.message).toBe("Connection closed");
  });

  it("does not let one classification leak into a concurrently classified incident", async () => {
    const incidents = [
      wrapped(adminShutdown()),
      wrapped(uniqueViolation()),
      wrapped(poolClosed()),
      new Error("Calendar query failed: 404 Not Found"),
    ];

    const classifyRound = async (): Promise<(string | null)[]> => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      return incidents.map((error) => classifyDatabaseError(error)?.slug ?? null);
    };

    const rounds = await Promise.all(Array.from({ length: 25 }, () => classifyRound()));

    for (const round of rounds) {
      expect(round).toEqual([
        "db-connection-unavailable",
        null,
        "db-connection-unavailable",
        null,
      ]);
    }
  });
});
