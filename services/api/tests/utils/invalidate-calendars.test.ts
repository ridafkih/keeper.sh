import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getCalendarsAffectedByAccountMutation } from "../../src/utils/invalidate-calendars";

interface CalendarRow {
  calendarId: string | null;
}

interface MappingRow {
  destinationProviderCalendarKey: string;
  isSameOwner: boolean;
  sourceProviderCalendarKey: string;
  sourceUserId: string;
  mapping: {
    destinationCalendarId: string;
    includeUpstreamSources: boolean;
    sourceCalendarId: string;
  };
}

type SelectBuilder<TRow> = Promise<TRow[]> & {
  from: () => SelectBuilder<TRow>;
  innerJoin: () => SelectBuilder<TRow>;
  leftJoin: () => SelectBuilder<TRow>;
  where: (condition: SQL) => SelectBuilder<TRow>;
};

const mapping = (
  sourceCalendarId: string,
  destinationCalendarId: string,
  includeUpstreamSources = false,
): MappingRow => ({
  destinationProviderCalendarKey: destinationCalendarId,
  isSameOwner: true,
  mapping: { destinationCalendarId, includeUpstreamSources, sourceCalendarId },
  sourceProviderCalendarKey: sourceCalendarId,
  sourceUserId: "owner-user",
});

const createBuilder = <TRow>(
  rows: TRow[],
  capture?: { query: { sql: string; params: unknown[] } | null },
): SelectBuilder<TRow> => {
  const builder = Promise.resolve(rows) as SelectBuilder<TRow>;
  builder.from = () => builder;
  builder.innerJoin = () => builder;
  builder.leftJoin = () => builder;
  builder.where = (condition) => {
    if (capture) {
      capture.query = new PgDialect().sqlToQuery(condition);
    }
    return builder;
  };
  return builder;
};

const readDirectDestinations = (ownedRows: CalendarRow[], mappingRows: MappingRow[]) => {
  const ownedCalendarIds = new Set(ownedRows.map((row) => row.calendarId));
  return mappingRows
    .filter((row) => ownedCalendarIds.has(row.mapping.sourceCalendarId))
    .map((row) => ({
      destinationCalendarId: row.mapping.destinationCalendarId,
      feedsInheritingLink: mappingRows.some((candidate) =>
        candidate.mapping.includeUpstreamSources
        && candidate.mapping.sourceCalendarId === row.mapping.destinationCalendarId),
    }));
};

const createDatabase = (
  ownedRows: CalendarRow[],
  mappingRows: MappingRow[] = [],
  capture?: { query: { sql: string; params: unknown[] } | null },
): BunSQLDatabase => {
  let selectCount = 0;
  return {
    select: () => {
      selectCount += 1;
      if (selectCount === 1) {
        return createBuilder(ownedRows, capture);
      }
      if (selectCount === 2) {
        return createBuilder(readDirectDestinations(ownedRows, mappingRows));
      }
      return createBuilder(mappingRows);
    },
  } as unknown as BunSQLDatabase;
};

describe("getCalendarsAffectedByAccountMutation", () => {
  it("does not expose calendars when the account is not owned", async () => {
    const captured: { query: { sql: string; params: unknown[] } | null } = { query: null };

    const result = await getCalendarsAffectedByAccountMutation(
      createDatabase([], [], captured),
      "attacker-user",
      "victim-account",
    );

    expect(result).toEqual({ calendarIds: [], owned: false });
    expect(captured.query?.sql).toContain('"calendar_accounts"."userId" =');
    expect(captured.query?.params).toEqual(["victim-account", "attacker-user"]);
  });

  it("includes owned calendars and destinations fed by their sources", async () => {
    const result = await getCalendarsAffectedByAccountMutation(
      createDatabase(
        [{ calendarId: "source-1" }, { calendarId: "destination-1" }],
        [mapping("source-1", "destination-1"), mapping("source-1", "destination-2")],
      ),
      "owner-user",
      "owned-account",
    );

    expect(result).toEqual({
      calendarIds: ["source-1", "destination-1", "destination-2"],
      owned: true,
    });
  });

  it("includes destinations that inherit an owned source through a chained link", async () => {
    const result = await getCalendarsAffectedByAccountMutation(
      createDatabase(
        [{ calendarId: "source-1" }],
        [
          mapping("source-1", "middle-1"),
          mapping("middle-1", "final-1", true),
          mapping("final-1", "beyond-1", true),
        ],
      ),
      "owner-user",
      "owned-account",
    );

    expect(result).toEqual({
      calendarIds: ["source-1", "middle-1", "beyond-1", "final-1"],
      owned: true,
    });
  });

  it("stops at a link that has not opted in to upstream sources", async () => {
    const result = await getCalendarsAffectedByAccountMutation(
      createDatabase(
        [{ calendarId: "source-1" }],
        [mapping("source-1", "middle-1"), mapping("middle-1", "final-1")],
      ),
      "owner-user",
      "owned-account",
    );

    expect(result).toEqual({ calendarIds: ["source-1", "middle-1"], owned: true });
  });

  it("allows deleting an owned account that has no calendars", async () => {
    const result = await getCalendarsAffectedByAccountMutation(
      createDatabase([{ calendarId: null }]),
      "owner-user",
      "empty-account",
    );

    expect(result).toEqual({ calendarIds: [], owned: true });
  });
});
