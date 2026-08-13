import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
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
  "endTime" timestamp not null,
  "exceptionDates" text,
  "isAllDay" boolean,
  "location" text,
  "recurrenceId" timestamp,
  "recurrenceRule" text,
  "sourceEventUid" text,
  "startTime" timestamp not null,
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
  "startTime" timestamp not null,
  "endTime" timestamp not null,
  "startTimeZone" text
);
`;

const client = new PGlite();
const database = drizzle(client) as unknown as KeeperDatabase;

const USER_ID = "user-synced-window";
const CALENDAR_ID = "00000000-0000-4000-8000-0000000002c1";
const ACCOUNT_ID = "00000000-0000-4000-8000-0000000002a1";

const ONE_OFF_TITLE = "Off-grid all-day synced event";
const RECURRING_TITLE = "Off-grid all-day synced series";

beforeAll(async () => {
  await client.exec(DDL);
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [ACCOUNT_ID, "google", USER_ID],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url") values ($1, $2, $3, $4, $5)`,
    [CALENDAR_ID, ACCOUNT_ID, USER_ID, "Personal", null],
  );
  await client.query(
    `insert into event_states ("id", "calendarId", "title", "availability", "isAllDay", "startTime", "endTime", "sourceEventUid")
     values ($1, $2, $3, 'busy', true, $4, $5, $6)`,
    [
      "00000000-0000-4000-8000-0000000002e1",
      CALENDAR_ID,
      ONE_OFF_TITLE,
      "2027-05-10T09:00:00.000Z",
      "2027-05-10T17:00:00.000Z",
      "synced-one-off",
    ],
  );
  await client.query(
    `insert into event_states ("id", "calendarId", "title", "availability", "isAllDay", "startTime", "endTime", "sourceEventUid", "recurrenceRule")
     values ($1, $2, $3, 'busy', true, $4, $5, $6, $7)`,
    [
      "00000000-0000-4000-8000-0000000002e2",
      CALENDAR_ID,
      RECURRING_TITLE,
      "2027-05-10T09:00:00.000Z",
      "2027-05-10T17:00:00.000Z",
      "synced-series",
      JSON.stringify({ count: 3, frequency: "DAILY" }),
    ],
  );
});

const listTitles = async (from: string, to: string): Promise<string[]> => {
  const events = await getEventsInRange(
    database,
    USER_ID,
    { from: new Date(from), to: new Date(to) },
  );
  return events.map((event) => event.title ?? "");
};

describe("an off-grid all-day synced event read through a narrower window", () => {
  it("is published across the whole day when the window is the whole day", async () => {
    const events = await getEventsInRange(
      database,
      USER_ID,
      { from: new Date("2027-05-10T00:00:00.000Z"), to: new Date("2027-05-11T00:00:00.000Z") },
    );
    const oneOff = events.find((event) => event.title === ONE_OFF_TITLE);

    expect({ end: oneOff?.endTime, start: oneOff?.startTime }).toEqual({
      end: "2027-05-11T00:00:00.000Z",
      start: "2027-05-10T00:00:00.000Z",
    });
  });

  it("is listed by every sub-window the published span covers", async () => {
    const windows: [string, string][] = [
      ["2027-05-10T00:00:00.000Z", "2027-05-10T06:00:00.000Z"],
      ["2027-05-10T02:00:00.000Z", "2027-05-10T03:00:00.000Z"],
      ["2027-05-10T18:00:00.000Z", "2027-05-10T23:00:00.000Z"],
    ];

    const missing: string[] = [];
    for (const [from, to] of windows) {
      const titles = await listTitles(from, to);
      if (!titles.includes(ONE_OFF_TITLE)) {
        missing.push(`one-off ${from}..${to}`);
      }
      if (!titles.includes(RECURRING_TITLE)) {
        missing.push(`series ${from}..${to}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps the morning it covers from being offered as free time", async () => {
    const { slots } = await findFreeTime(
      database,
      USER_ID,
      { from: new Date("2027-05-10T00:00:00.000Z"), to: new Date("2027-05-10T06:00:00.000Z") },
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

  it("does not leak into the day before the span it publishes", async () => {
    const titles = await listTitles("2027-05-09T00:00:00.000Z", "2027-05-09T23:00:00.000Z");

    expect(titles).toEqual([]);
  });
});
