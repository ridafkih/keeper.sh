import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildEventStateInsertRow,
  insertEventStatesWithConflictResolution,
} from "@keeper.sh/calendar";
import type { EventStateInsertClient } from "@keeper.sh/calendar";
import { findFreeTime } from "../../src/queries/find-free-time";
import { getEvent } from "../../src/queries/get-event";
import { getEventCount } from "../../src/queries/get-event-count";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
import type { KeeperDatabase } from "../../src/types";

const USER_ID = "user-created-event";
const ACCOUNT_ID = "00000000-0000-4000-8000-00000000a001";
const CALENDAR_ID = "00000000-0000-4000-8000-00000000b001";
const OTHER_CALENDAR_ID = "00000000-0000-4000-8000-00000000b002";
const PLACEHOLDER_ID = "00000000-0000-4000-8000-00000000c001";
const CREATED_UID = "6f1c2a4e-created@user.keeper.sh";

const WINDOW = {
  from: new Date("2027-06-14T00:00:00.000Z"),
  to: new Date("2027-06-14T23:59:59.000Z"),
};

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
  "createdAt" timestamptz not null default now(),
  "id" uuid primary key default gen_random_uuid(),
  "calendarId" uuid not null,
  "availability" text,
  "description" text,
  "endTime" timestamptz not null,
  "exceptionDates" text,
  "isAllDay" boolean,
  "location" text,
  "recurrenceId" timestamptz,
  "recurrenceRule" text,
  "sourceEventId" text,
  "sourceEventType" text,
  "sourceEventUid" text,
  "startTime" timestamptz not null,
  "startTimeZone" text,
  "title" text
);
create unique index event_states_source_event_idx
  on event_states ("calendarId", "sourceEventId") where "sourceEventId" is not null;
create unique index event_states_recurring_instance_idx
  on event_states ("calendarId", "sourceEventUid", "recurrenceId")
  where "sourceEventId" is null and "recurrenceId" is not null;
create unique index event_states_non_recurring_instance_idx
  on event_states ("calendarId", "sourceEventUid", "startTime", "endTime")
  where "sourceEventId" is null and "recurrenceId" is null;
create table user_events (
  "id" uuid primary key default gen_random_uuid(),
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
const database = drizzle(client);
const readDatabase = database as unknown as KeeperDatabase;
const ingestDatabase = database as unknown as EventStateInsertClient;

interface EventTimes {
  endTime: string;
  startTime: string;
}

const CREATED_TIMES: EventTimes = {
  endTime: "2027-06-14T10:00:00.000Z",
  startTime: "2027-06-14T09:00:00.000Z",
};

const recordCreatedEvent = async (calendarId: string, times: EventTimes): Promise<void> => {
  await client.query(
    `insert into user_events ("id", "calendarId", "userId", "sourceEventUid", "title", "availability", "isAllDay", "startTime", "endTime")
     values ($1, $2, $3, $4, 'Planning', 'busy', false, $5, $6)`,
    [PLACEHOLDER_ID, calendarId, USER_ID, CREATED_UID, times.startTime, times.endTime],
  );
};

const ingestFromProvider = async (calendarId: string, times: EventTimes): Promise<void> => {
  await insertEventStatesWithConflictResolution(ingestDatabase, [
    buildEventStateInsertRow(calendarId, {
      availability: "busy",
      endTime: new Date(times.endTime),
      isAllDay: false,
      startTime: new Date(times.startTime),
      title: "Planning",
      uid: CREATED_UID,
    }),
  ]);
};

const freeTimeOptions = {
  durationMinutes: 60,
  ignoreAllDayEvents: false,
  limit: 50,
  timezone: "UTC",
  workingHours: null,
};

const isFreeBetween = async (start: string, end: string): Promise<boolean> => {
  const result = await findFreeTime(readDatabase, USER_ID, WINDOW, freeTimeOptions);
  return result.slots.some((slot) =>
    Date.parse(slot.start) <= Date.parse(start) && Date.parse(slot.end) >= Date.parse(end));
};

beforeEach(async () => {
  await client.exec("drop table if exists calendar_accounts, calendars, event_states, user_events");
  await client.exec(DDL);
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, 'google', $2)`,
    [ACCOUNT_ID, USER_ID],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name") values ($1, $2, $3, 'Work'), ($4, $2, $3, 'Personal')`,
    [CALENDAR_ID, ACCOUNT_ID, USER_ID, OTHER_CALENDAR_ID],
  );
});

describe("an event created through the API", () => {
  it("is listed once before the source calendar has been pulled", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);

    const events = await getEventsInRange(readDatabase, USER_ID, WINDOW);

    expect(events.map((event) => event.id)).toEqual([PLACEHOLDER_ID]);
  });

  it("is listed once after the source calendar pull ingests it", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);
    await ingestFromProvider(CALENDAR_ID, CREATED_TIMES);

    const events = await getEventsInRange(readDatabase, USER_ID, WINDOW);

    expect(events.map((event) => event.title)).toEqual(["Planning"]);
  });

  it("keeps the id the create call returned once it is ingested", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);
    await ingestFromProvider(CALENDAR_ID, CREATED_TIMES);

    const events = await getEventsInRange(readDatabase, USER_ID, WINDOW);
    const event = await getEvent(readDatabase, USER_ID, PLACEHOLDER_ID);

    expect(events.map((listed) => listed.id)).toEqual([PLACEHOLDER_ID]);
    expect(event?.title).toBe("Planning");
  });

  it("is counted once after it is ingested", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);
    await ingestFromProvider(CALENDAR_ID, CREATED_TIMES);

    expect(await getEventCount(readDatabase, USER_ID)).toBe(1);
    expect(await getEventCount(readDatabase, USER_ID, WINDOW)).toBe(1);
  });

  it("stops blocking its original slot once the provider's moved copy is ingested", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);
    await ingestFromProvider(CALENDAR_ID, {
      endTime: "2027-06-14T15:00:00.000Z",
      startTime: "2027-06-14T14:00:00.000Z",
    });

    const events = await getEventsInRange(readDatabase, USER_ID, WINDOW);

    expect(events.map((event) => event.startTime)).toEqual(["2027-06-14T14:00:00.000Z"]);
    expect(await isFreeBetween(CREATED_TIMES.startTime, CREATED_TIMES.endTime)).toBe(true);
  });

  it("is untouched by an ingest of a different calendar carrying the same UID", async () => {
    await recordCreatedEvent(CALENDAR_ID, CREATED_TIMES);
    await ingestFromProvider(OTHER_CALENDAR_ID, CREATED_TIMES);

    const event = await getEvent(readDatabase, USER_ID, PLACEHOLDER_ID);

    expect(event?.calendarId).toBe(CALENDAR_ID);
    expect(await getEventCount(readDatabase, USER_ID)).toBe(2);
  });
});
