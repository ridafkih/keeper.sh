import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { isBackoffEligibleError } from "../src/destination-errors";

const MAPPING_UPSERT_SQL =
  'insert into "event_mappings" ("calendar_id", "external_event_id", "uid", "content_hash") '
  + "values ($1, $2, $3, $4) on conflict (\"calendar_id\", \"uid\") do update set "
  + '"external_event_id" = excluded."external_event_id"';

const mappingUpsertFailure = (
  params: unknown[],
  driverFields: Record<string, unknown>,
): DrizzleQueryError =>
  new DrizzleQueryError(
    MAPPING_UPSERT_SQL,
    params,
    Object.assign(new Error("deadlock detected"), { name: "PostgresError" }, driverFields),
  );

const DEADLOCK = { code: "ERR_POSTGRES_SERVER_ERROR", errno: "40P01" };

describe("isBackoffEligibleError against our own database failures", () => {
  it("does not back a destination off for an ordinary database write failure", () => {
    const error = mappingUpsertFailure(
      ["calendar-1", "abc-123", "uid-1@fastmail.com", "0f1a"],
      DEADLOCK,
    );

    expect(isBackoffEligibleError(error)).toBe(false);
  });

  it("does not back a destination off when a bound parameter carries provider-error text", () => {
    const error = mappingUpsertFailure(
      ["calendar-1", "evt-9", "Postmortem: 404 Not Found spike@keeper.sh", "0f1a"],
      DEADLOCK,
    );

    expect(isBackoffEligibleError(error)).toBe(false);
  });

  it("does not back a destination off when a bound parameter reads Invalid credentials", () => {
    const error = mappingUpsertFailure(
      ["calendar-1", "evt-9", "Invalid credentials runbook@keeper.sh", "0f1a"],
      DEADLOCK,
    );

    expect(isBackoffEligibleError(error)).toBe(false);
  });

  it("does not back a destination off when the pool drops mid-flush", () => {
    const error = mappingUpsertFailure(
      ["calendar-1", "evt-9", "uid-1@fastmail.com", "0f1a"],
      { code: "ERR_POSTGRES_CONNECTION_CLOSED" },
    );

    expect(isBackoffEligibleError(error)).toBe(false);
  });

  it("still backs off a genuine provider failure", () => {
    expect(isBackoffEligibleError(new Error("CalDAV request failed: 404 Not Found"))).toBe(true);
    expect(isBackoffEligibleError(new Error("Invalid credentials"))).toBe(true);
  });

  it("returns the same verdict for the same failure on repeated attempts", () => {
    const verdicts = Array.from({ length: 3 }, () =>
      isBackoffEligibleError(
        mappingUpsertFailure(
          ["calendar-1", "evt-9", "Postmortem: 404 Not Found spike@keeper.sh", "0f1a"],
          DEADLOCK,
        ),
      ));

    expect(new Set(verdicts).size).toBe(1);
  });
});
