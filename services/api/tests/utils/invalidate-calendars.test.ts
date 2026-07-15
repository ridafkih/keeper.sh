import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type Redis from "ioredis";
import { invalidateCalendarsForAccount } from "../../src/utils/invalidate-calendars";

interface CalendarRow {
  calendarId: string | null;
}

type SelectBuilder = Promise<CalendarRow[]> & {
  from: () => SelectBuilder;
  leftJoin: () => SelectBuilder;
  where: (condition: SQL) => SelectBuilder;
};

const createDatabase = (
  rows: CalendarRow[],
  capture?: { query: { sql: string; params: unknown[] } | null },
): BunSQLDatabase => {
  const builder = Promise.resolve(rows) as SelectBuilder;
  builder.from = () => builder;
  builder.leftJoin = () => builder;
  builder.where = (condition) => {
    if (capture) {
      capture.query = new PgDialect().sqlToQuery(condition);
    }
    return builder;
  };

  return {
    select: () => builder,
  } as unknown as BunSQLDatabase;
};

const createRedis = () => {
  const writes: [string, string, string, number][] = [];
  let execCalls = 0;
  const pipeline = {
    exec: () => {
      execCalls += 1;
      return Promise.resolve([]);
    },
    set: (...args: [string, string, string, number]) => {
      writes.push(args);
      return pipeline;
    },
  };

  return {
    execCalls: () => execCalls,
    redis: { pipeline: () => pipeline } as unknown as Redis,
    writes,
  };
};

describe("invalidateCalendarsForAccount", () => {
  it("does not write invalidation keys when the account is not owned", async () => {
    const { redis, writes, execCalls } = createRedis();
    const captured: { query: { sql: string; params: unknown[] } | null } = { query: null };

    const owned = await invalidateCalendarsForAccount(
      createDatabase([], captured),
      redis,
      "attacker-user",
      "victim-account",
    );

    expect(owned).toBe(false);
    expect(writes).toEqual([]);
    expect(execCalls()).toBe(0);
    expect(captured.query?.sql).toContain('"calendar_accounts"."userId" =');
    expect(captured.query?.params).toEqual(["victim-account", "attacker-user"]);
  });

  it("invalidates every calendar after ownership is established", async () => {
    const { redis, writes, execCalls } = createRedis();

    const owned = await invalidateCalendarsForAccount(
      createDatabase([{ calendarId: "calendar-1" }, { calendarId: "calendar-2" }]),
      redis,
      "owner-user",
      "owned-account",
    );

    expect(owned).toBe(true);
    expect(writes).toEqual([
      ["sync:invalidated:calendar-1", "1", "EX", 300],
      ["sync:invalidated:calendar-2", "1", "EX", 300],
    ]);
    expect(execCalls()).toBe(1);
  });

  it("allows deleting an owned account that has no calendars", async () => {
    const { redis, writes, execCalls } = createRedis();

    const owned = await invalidateCalendarsForAccount(
      createDatabase([{ calendarId: null }]),
      redis,
      "owner-user",
      "empty-account",
    );

    expect(owned).toBe(true);
    expect(writes).toEqual([]);
    expect(execCalls()).toBe(0);
  });
});
