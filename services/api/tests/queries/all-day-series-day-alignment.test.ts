import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
import { getEventCount } from "../../src/queries/get-event-count";
import { findFreeTime } from "../../src/queries/find-free-time";
import type { KeeperDatabase } from "../../src/types";

const DDL = `
create table calendar_accounts (
  "id" uuid primary key,
  "provider" text not null,
  "userId" text not null
);
create table calendars (
  "id" uuid primary key,
  "accountId" uuid not null,
  "userId" text not null,
  "name" text not null,
  "url" text,
  "calendarType" text not null default 'source',
  "capabilities" text[] not null default '{"pull"}'
);
create table event_states (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "availability" text,
  "description" text,
  "endTime" timestamptz not null,
  "exceptionDates" text,
  "isAllDay" boolean,
  "location" text,
  "recurrenceId" timestamptz,
  "recurrenceRule" text,
  "sourceEventUid" text,
  "startTime" timestamptz not null,
  "startTimeZone" text,
  "title" text
);
create table user_events (
  "id" uuid primary key,
  "calendarId" uuid not null,
  "userId" text not null,
  "sourceEventUid" text,
  "title" text,
  "description" text,
  "location" text,
  "availability" text,
  "isAllDay" boolean,
  "startTime" timestamptz not null,
  "endTime" timestamptz not null,
  "startTimeZone" text
);
`;

const client = new PGlite();
const database = drizzle(client) as unknown as KeeperDatabase;

const USER_ID = "user-all-day-series";
const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a1";
const CALENDAR_ID = "00000000-0000-4000-8000-0000000000c1";
const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";

const WEEK_START = "2027-03-12T00:00:00.000Z";
const WEEK_END = "2027-03-20T00:00:00.000Z";

beforeAll(async () => {
  await client.exec(DDL);
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [ACCOUNT_ID, "google", USER_ID],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url") values ($1, $2, $3, $4, $5)`,
    [CALENDAR_ID, ACCOUNT_ID, USER_ID, "Primary", null],
  );
  await client.query(
    `insert into event_states (
      "id", "calendarId", "availability", "endTime", "isAllDay", "recurrenceRule",
      "sourceEventUid", "startTime", "startTimeZone", "title"
    ) values ($1, $2, 'busy', $3, true, $4, $5, $6, $7, $8)`,
    [
      EVENT_ID,
      CALENDAR_ID,
      "2027-03-13T00:00:00.000Z",
      JSON.stringify({ count: 8, frequency: "DAILY" }),
      "series@google.com",
      "2027-03-12T00:00:00.000Z",
      "America/New_York",
      "Daily all-day standup",
    ],
  );
});

const readWeek = async (): Promise<{ end: string; start: string }[]> => {
  const events = await getEventsInRange(
    database,
    USER_ID,
    { from: new Date(WEEK_START), to: new Date(WEEK_END) },
  );
  return events.map((event) => ({ end: event.endTime, start: event.startTime }));
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("reading a daily all-day series across a daylight transition", () => {
  it("publishes one whole day per occurrence", async () => {
    const spans = await readWeek();

    expect(spans.map((span) =>
      (new Date(span.end).getTime() - new Date(span.start).getTime()) / MS_PER_DAY))
      .toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("starts each occurrence on its own day", async () => {
    const spans = await readWeek();
    const starts = spans.map((span) => span.start);

    expect(new Set(starts).size).toBe(starts.length);
  });

  it("answers the same span on a second read", async () => {
    expect(await readWeek()).toEqual(await readWeek());
  });

  it("counts the occurrences the listing publishes", async () => {
    const count = await getEventCount(database, USER_ID, {
      from: new Date(WEEK_START),
      to: new Date(WEEK_END),
    });

    const published = await readWeek();
    expect(count).toBe(published.length);
  });

  it("blocks the last day of the series", async () => {
    const { slots } = await findFreeTime(
      database,
      USER_ID,
      { from: new Date("2027-03-19T00:00:00.000Z"), to: new Date("2027-03-20T00:00:00.000Z") },
      {
        durationMinutes: 30,
        ignoreAllDayEvents: false,
        limit: 50,
        timezone: "Etc/UTC",
        workingHours: null,
      },
    );

    expect(slots).toEqual([]);
  });
});
