import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getCalendarsAffectedByAccountMutation } from "../../src/utils/invalidate-calendars";

interface CalendarRow {
  calendarId: string | null;
}

type SelectBuilder = Promise<CalendarRow[]> & {
  from: () => SelectBuilder;
  leftJoin: () => SelectBuilder;
  where: (condition: SQL) => SelectBuilder;
};

const createBuilder = (
  rows: CalendarRow[],
  capture?: { query: { sql: string; params: unknown[] } | null },
): SelectBuilder => {
  const builder = Promise.resolve(rows) as SelectBuilder;
  builder.from = () => builder;
  builder.leftJoin = () => builder;
  builder.where = (condition) => {
    if (capture) {
      capture.query = new PgDialect().sqlToQuery(condition);
    }
    return builder;
  };
  return builder;
};

const createDatabase = (
  ownedRows: CalendarRow[],
  mappedDestinationRows: CalendarRow[] = [],
  capture?: { query: { sql: string; params: unknown[] } | null },
): BunSQLDatabase => {
  let selectCount = 0;
  return {
    select: () => {
      selectCount += 1;
      if (selectCount === 1) {
        return createBuilder(ownedRows, capture);
      }
      return createBuilder(mappedDestinationRows);
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
        [{ calendarId: "destination-2" }, { calendarId: "destination-1" }],
      ),
      "owner-user",
      "owned-account",
    );

    expect(result).toEqual({
      calendarIds: ["source-1", "destination-1", "destination-2"],
      owned: true,
    });
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
