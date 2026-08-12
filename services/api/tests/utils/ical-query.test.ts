import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildFeedCalendarsQuery, buildFeedEventQuery } from "../../src/utils/ical";

const database = drizzle.mock();

const FEED_WINDOW = {
  windowEnd: new Date("2028-08-12T00:00:00.000Z"),
  windowStart: new Date("2026-07-12T00:00:00.000Z"),
};

const eventQuery = (): { sql: string; params: unknown[] } =>
  buildFeedEventQuery(database, ["calendar-a", "calendar-b"], FEED_WINDOW).toSQL();

const eventSql = (): string => eventQuery().sql;

describe("buildFeedEventQuery", () => {
  it("keeps the working-location exclusion in the where clause", () => {
    const { sql, params } = eventQuery();

    expect(sql).toContain(`"event_states"."sourceEventType" is null`);
    expect(sql).toContain(`"event_states"."sourceEventType" <> $`);
    expect(params).toContain("workingLocation");
  });

  it("keeps the working-elsewhere availability exclusion in the where clause", () => {
    const { sql, params } = eventQuery();

    expect(sql).toContain(`"event_states"."availability" is null`);
    expect(sql).toContain(`"event_states"."availability" <> $`);
    expect(params).toContain("workingElsewhere");
  });

  it("projects sourceEventType so per-feed filters can run in the formatter", () => {
    const sql = eventSql();
    const [projection] = sql.split(" from ");

    expect(projection).toContain(`"event_states"."sourceEventType"`);
  });

  it("orders by start time ascending within the feed's horizon", () => {
    const { params, sql } = eventQuery();

    expect(sql).toContain(`order by "event_states"."startTime" asc`);
    expect(sql).toContain(`"event_states"."startTime" <= $`);
    expect(params).toContain(FEED_WINDOW.windowEnd.toISOString());
    expect(params).toContain(FEED_WINDOW.windowStart.toISOString());
  });
});

describe("buildFeedCalendarsQuery", () => {
  it("re-checks calendar ownership when reading feed membership", () => {
    const { sql, params } = buildFeedCalendarsQuery(database, {
      feedId: "feed-1",
      userId: "user-1",
    }).toSQL();

    expect(sql).toContain("ical_feed_calendars");
    expect(sql).toContain(`"calendars"."syncFutureRange"`);
    expect(sql).toContain(`"calendars"."syncHistoricRange"`);
    expect(sql).toContain(`"ical_feed_calendars"."feedId" = $`);
    expect(sql).toContain(`"calendars"."userId" = $`);
    expect(params).toContain("feed-1");
    expect(params).toContain("user-1");
  });
});
