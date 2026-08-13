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

interface Scenario {
  calendarId: string;
  endTime: string;
  eventId: string;
  isAllDay: boolean;
  startTime: string;
  title: string;
  userId: string;
}

const SCENARIOS = {
  midnightSpanningPoint: {
    calendarId: "00000000-0000-4000-8000-0000000001c2",
    endTime: "2027-05-10T23:59:30.000Z",
    eventId: "00000000-0000-4000-8000-0000000001e2",
    isAllDay: false,
    startTime: "2027-05-10T23:59:30.000Z",
    title: "Point event just before midnight",
    userId: "user-midnight-point",
  },
  raggedAllDay: {
    calendarId: "00000000-0000-4000-8000-0000000001c1",
    endTime: "2027-05-10T17:00:00.000Z",
    eventId: "00000000-0000-4000-8000-0000000001e1",
    isAllDay: true,
    startTime: "2027-05-10T09:00:00.000Z",
    title: "Off-grid all-day event",
    userId: "user-ragged-window",
  },
} satisfies Record<string, Scenario>;

const seed = async (scenario: Scenario, index: number): Promise<void> => {
  const accountId = `00000000-0000-4000-8000-00000000b00${index}`;
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [accountId, "google", scenario.userId],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url") values ($1, $2, $3, $4, $5)`,
    [scenario.calendarId, accountId, scenario.userId, "Personal", null],
  );
  await client.query(
    `insert into user_events ("id", "calendarId", "userId", "title", "availability", "isAllDay", "startTime", "endTime")
     values ($1, $2, $3, $4, 'busy', $5, $6, $7)`,
    [
      scenario.eventId,
      scenario.calendarId,
      scenario.userId,
      scenario.title,
      scenario.isAllDay,
      scenario.startTime,
      scenario.endTime,
    ],
  );
};

beforeAll(async () => {
  await client.exec(DDL);
  for (const [index, scenario] of Object.values(SCENARIOS).entries()) {
    await seed(scenario, index);
  }
});

const listTitles = async (scenario: Scenario, from: string, to: string): Promise<string[]> => {
  const events = await getEventsInRange(
    database,
    scenario.userId,
    { from: new Date(from), to: new Date(to) },
  );
  return events.map((event) => event.title ?? "");
};

const freeSlots = async (
  scenario: Scenario,
  from: string,
  to: string,
): Promise<{ start: string; end: string }[]> => {
  const { slots } = await findFreeTime(
    database,
    scenario.userId,
    { from: new Date(from), to: new Date(to) },
    {
      durationMinutes: 30,
      ignoreAllDayEvents: false,
      limit: 50,
      timezone: "Etc/UTC",
      workingHours: null,
    },
  );
  return slots;
};

const DAY_START = "2027-05-10T00:00:00.000Z";
const DAY_END = "2027-05-11T00:00:00.000Z";

describe("an off-grid all-day event read through a narrower window", () => {
  it("is published across the whole day when the window is the whole day", async () => {
    const events = await getEventsInRange(
      database,
      SCENARIOS.raggedAllDay.userId,
      { from: new Date(DAY_START), to: new Date(DAY_END) },
    );

    expect({ end: events[0]?.endTime, start: events[0]?.startTime }).toEqual({
      end: DAY_END,
      start: DAY_START,
    });
  });

  it("is listed by every sub-window the published span covers", async () => {
    const windows: [string, string][] = [
      ["2027-05-10T00:00:00.000Z", "2027-05-10T06:00:00.000Z"],
      ["2027-05-10T02:00:00.000Z", "2027-05-10T03:00:00.000Z"],
      ["2027-05-10T08:00:00.000Z", "2027-05-10T10:00:00.000Z"],
      ["2027-05-10T12:00:00.000Z", "2027-05-10T13:00:00.000Z"],
      ["2027-05-10T18:00:00.000Z", "2027-05-10T23:00:00.000Z"],
    ];

    const missing: string[] = [];
    for (const [from, to] of windows) {
      const titles = await listTitles(SCENARIOS.raggedAllDay, from, to);
      if (!titles.includes(SCENARIOS.raggedAllDay.title)) {
        missing.push(`${from}..${to}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps the morning it covers from being offered as free time", async () => {
    const slots = await freeSlots(
      SCENARIOS.raggedAllDay,
      "2027-05-10T00:00:00.000Z",
      "2027-05-10T06:00:00.000Z",
    );

    expect(slots).toEqual([]);
  });

  it("answers the same on a repeated narrow read", async () => {
    const first = await listTitles(
      SCENARIOS.raggedAllDay,
      "2027-05-10T00:00:00.000Z",
      "2027-05-10T06:00:00.000Z",
    );
    const second = await listTitles(
      SCENARIOS.raggedAllDay,
      "2027-05-10T00:00:00.000Z",
      "2027-05-10T06:00:00.000Z",
    );

    expect(second).toEqual(first);
  });
});

describe("a point event whose published minute crosses midnight", () => {
  it("is published as a minute that ends on the following day", async () => {
    const events = await getEventsInRange(
      database,
      SCENARIOS.midnightSpanningPoint.userId,
      { from: new Date(DAY_START), to: new Date(DAY_END) },
    );

    expect(events[0]?.endTime).toBe("2027-05-11T00:00:30.000Z");
  });

  it("blocks the half minute it reaches into the following day", async () => {
    const slots = await freeSlots(
      SCENARIOS.midnightSpanningPoint,
      "2027-05-11T00:00:00.000Z",
      "2027-05-11T06:00:00.000Z",
    );

    const coversInstant = slots.some((slot) =>
      new Date(slot.start) <= new Date("2027-05-11T00:00:15.000Z")
      && new Date(slot.end) > new Date("2027-05-11T00:00:15.000Z"));

    expect(coversInstant).toBe(false);
  });
});
