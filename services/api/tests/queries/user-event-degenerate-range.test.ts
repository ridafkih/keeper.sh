import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
import { getEvent } from "../../src/queries/get-event";
import { getEventCount } from "../../src/queries/get-event-count";
import { findFreeTime } from "../../src/queries/find-free-time";
import type { KeeperDatabase } from "../../src/types";

const WINDOW_START = new Date("2027-05-10T00:00:00.000Z");
const WINDOW_END = new Date("2027-05-11T00:00:00.000Z");

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
  invertedTimed: {
    calendarId: "00000000-0000-4000-8000-0000000000c1",
    endTime: "2027-05-09T18:00:00.000Z",
    eventId: "00000000-0000-4000-8000-0000000000e1",
    isAllDay: false,
    startTime: "2027-05-10T14:00:00.000Z",
    title: "Inverted user event",
    userId: "user-inverted",
  },
  raggedAllDay: {
    calendarId: "00000000-0000-4000-8000-0000000000c3",
    endTime: "2027-05-10T17:00:00.000Z",
    eventId: "00000000-0000-4000-8000-0000000000e3",
    isAllDay: true,
    startTime: "2027-05-10T09:00:00.000Z",
    title: "All-day user event off the UTC day grid",
    userId: "user-ragged",
  },
  sameDayAllDay: {
    calendarId: "00000000-0000-4000-8000-0000000000c2",
    endTime: "2027-05-10T00:00:00.000Z",
    eventId: "00000000-0000-4000-8000-0000000000e2",
    isAllDay: true,
    startTime: "2027-05-10T00:00:00.000Z",
    title: "Same-date all-day user event",
    userId: "user-same-day",
  },
  zeroDurationTimed: {
    calendarId: "00000000-0000-4000-8000-0000000000c4",
    endTime: "2027-05-10T14:00:00.000Z",
    eventId: "00000000-0000-4000-8000-0000000000e4",
    isAllDay: false,
    startTime: "2027-05-10T14:00:00.000Z",
    title: "Zero-duration user event",
    userId: "user-zero",
  },
} satisfies Record<string, Scenario>;

const seed = async (scenario: Scenario, index: number): Promise<void> => {
  const accountId = `00000000-0000-4000-8000-00000000a00${index}`;
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
  const scenarios = Object.values(SCENARIOS);
  for (const [index, scenario] of scenarios.entries()) {
    await seed(scenario, index);
  }
});

const readRange = (scenario: Scenario) => getEventsInRange(
  database,
  scenario.userId,
  { from: WINDOW_START, to: WINDOW_END },
);

const readFreeSlots = (scenario: Scenario) => findFreeTime(
  database,
  scenario.userId,
  { from: WINDOW_START, to: WINDOW_END },
  {
    durationMinutes: 30,
    ignoreAllDayEvents: false,
    limit: 50,
    timezone: "Etc/UTC",
    workingHours: null,
  },
);

const coversInstant = (
  slots: { start: string; end: string }[],
  instant: string,
): boolean => slots.some((slot) =>
  new Date(slot.start) <= new Date(instant) && new Date(slot.end) > new Date(instant));

describe("a locally created event whose end precedes its start", () => {
  it("is admitted by the scan behind get_events", async () => {
    const events = await readRange(SCENARIOS.invertedTimed);

    expect(events.map((event) => event.title)).toEqual(["Inverted user event"]);
  });

  it("is never published with an end that precedes its start", async () => {
    const event = await getEvent(
      database,
      SCENARIOS.invertedTimed.userId,
      SCENARIOS.invertedTimed.eventId,
    );

    expect(event).not.toBeNull();
    expect(new Date(event?.endTime ?? 0).getTime())
      .toBeGreaterThan(new Date(event?.startTime ?? 0).getTime());
  });

  it("is counted by the same window that lists it", async () => {
    const events = await readRange(SCENARIOS.invertedTimed);
    const counted = await getEventCount(
      database,
      SCENARIOS.invertedTimed.userId,
      { from: WINDOW_START, to: WINDOW_END },
    );

    expect(counted).toBe(events.length);
  });

  it("keeps the instant it names from being reported free", async () => {
    const { slots } = await readFreeSlots(SCENARIOS.invertedTimed);

    expect(coversInstant(slots, "2027-05-10T14:00:00.000Z")).toBe(false);
  });
});

describe("a locally created event whose start and end are the same instant", () => {
  it("is published as the minute it occupies rather than as a point", async () => {
    const [event] = await readRange(SCENARIOS.zeroDurationTimed);

    expect(event?.startTime).toBe("2027-05-10T14:00:00.000Z");
    expect(event?.endTime).toBe("2027-05-10T14:01:00.000Z");
  });

  it("blocks the same minute find_free_time withholds", async () => {
    const { slots } = await readFreeSlots(SCENARIOS.zeroDurationTimed);

    expect(coversInstant(slots, "2027-05-10T14:00:00.000Z")).toBe(false);
  });
});

describe("a locally created all-day event that names a single day", () => {
  it("is published across the whole day it names", async () => {
    const [event] = await readRange(SCENARIOS.sameDayAllDay);

    expect({ end: event?.endTime, start: event?.startTime }).toEqual({
      end: "2027-05-11T00:00:00.000Z",
      start: "2027-05-10T00:00:00.000Z",
    });
  });

  it("is published the same way through get_event", async () => {
    const [listed] = await readRange(SCENARIOS.sameDayAllDay);
    const fetched = await getEvent(
      database,
      SCENARIOS.sameDayAllDay.userId,
      SCENARIOS.sameDayAllDay.eventId,
    );

    expect({ end: fetched?.endTime, start: fetched?.startTime })
      .toEqual({ end: listed?.endTime, start: listed?.startTime });
  });

  it("blocks the whole day find_free_time withholds", async () => {
    const { slots } = await readFreeSlots(SCENARIOS.sameDayAllDay);

    expect(slots).toEqual([]);
  });
});

describe("a locally created all-day event that does not sit on the UTC day grid", () => {
  it("is published snapped onto the day it touches", async () => {
    const [event] = await readRange(SCENARIOS.raggedAllDay);

    expect({ end: event?.endTime, start: event?.startTime }).toEqual({
      end: "2027-05-11T00:00:00.000Z",
      start: "2027-05-10T00:00:00.000Z",
    });
  });

  it("answers identically on repeated reads", async () => {
    const first = await readRange(SCENARIOS.raggedAllDay);
    const second = await readRange(SCENARIOS.raggedAllDay);

    expect(second).toEqual(first);
  });
});
