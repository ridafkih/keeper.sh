import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventCount } from "../../src/queries/get-event-count";
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

interface Shape {
  endTime: string;
  isAllDay: boolean;
  name: string;
  startTime: string;
  windowEnd: string;
  windowStart: string;
}

const SHAPES: Shape[] = [
  {
    endTime: "2027-05-10T17:00:00.000Z",
    isAllDay: true,
    name: "an all-day range off the UTC day grid read through the morning it covers",
    startTime: "2027-05-10T09:00:00.000Z",
    windowEnd: "2027-05-10T06:00:00.000Z",
    windowStart: "2027-05-10T00:00:00.000Z",
  },
  {
    endTime: "2027-05-10T17:00:00.000Z",
    isAllDay: true,
    name: "an all-day range off the UTC day grid read through the whole day",
    startTime: "2027-05-10T09:00:00.000Z",
    windowEnd: "2027-05-11T00:00:00.000Z",
    windowStart: "2027-05-10T00:00:00.000Z",
  },
  {
    endTime: "2027-05-10T23:59:30.000Z",
    isAllDay: false,
    name: "a point event whose published minute crosses into the next day",
    startTime: "2027-05-10T23:59:30.000Z",
    windowEnd: "2027-05-11T06:00:00.000Z",
    windowStart: "2027-05-11T00:00:00.000Z",
  },
  {
    endTime: "2027-05-09T18:00:00.000Z",
    isAllDay: false,
    name: "a range whose end precedes its start",
    startTime: "2027-05-10T14:00:00.000Z",
    windowEnd: "2027-05-11T00:00:00.000Z",
    windowStart: "2027-05-10T00:00:00.000Z",
  },
  {
    endTime: "2027-05-10T00:00:00.000Z",
    isAllDay: true,
    name: "an all-day range naming a single date",
    startTime: "2027-05-10T00:00:00.000Z",
    windowEnd: "2027-05-11T00:00:00.000Z",
    windowStart: "2027-05-10T00:00:00.000Z",
  },
];

const pad = (value: number): string => value.toString().padStart(2, "0");

const toUuid = (value: string): string =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

const syncedUser = (index: number): string => `user-count-synced-${index}`;
const localUser = (index: number): string => `user-count-local-${index}`;

const seedCalendar = async (userId: string, suffix: string): Promise<string> => {
  const accountId = toUuid(`a${suffix}`);
  const calendarId = toUuid(`b${suffix}`);
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [accountId, "google", userId],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url") values ($1, $2, $3, $4, $5)`,
    [calendarId, accountId, userId, "Personal", null],
  );
  return calendarId;
};

const seed = async (shape: Shape, index: number): Promise<void> => {
  const syncedCalendarId = await seedCalendar(syncedUser(index), `10${pad(index)}`);
  await client.query(
    `insert into event_states ("id", "calendarId", "title", "availability", "isAllDay", "startTime", "endTime", "sourceEventUid")
     values ($1, $2, 'synced', 'busy', $3, $4, $5, $6)`,
    [
      toUuid(`c${pad(index)}`),
      syncedCalendarId,
      shape.isAllDay,
      shape.startTime,
      shape.endTime,
      `synced-count-${index}`,
    ],
  );

  const localCalendarId = await seedCalendar(localUser(index), `20${pad(index)}`);
  await client.query(
    `insert into user_events ("id", "calendarId", "userId", "title", "availability", "isAllDay", "startTime", "endTime")
     values ($1, $2, $3, 'local', 'busy', $4, $5, $6)`,
    [
      toUuid(`d${pad(index)}`),
      localCalendarId,
      localUser(index),
      shape.isAllDay,
      shape.startTime,
      shape.endTime,
    ],
  );
};

beforeAll(async () => {
  await client.exec(DDL);
  for (const [index, shape] of SHAPES.entries()) {
    await seed(shape, index);
  }
});

const readWindow = (shape: Shape) => ({
  from: new Date(shape.windowStart),
  to: new Date(shape.windowEnd),
});

describe("the number a window reports and the events that window lists", () => {
  for (const [index, shape] of SHAPES.entries()) {
    it(`agree for a synced row that is ${shape.name}`, async () => {
      const window = readWindow(shape);
      const listed = await getEventsInRange(database, syncedUser(index), window);
      const counted = await getEventCount(database, syncedUser(index), window);

      expect(counted).toBe(listed.length);
    });

    it(`agree for a locally created row that is ${shape.name}`, async () => {
      const window = readWindow(shape);
      const listed = await getEventsInRange(database, localUser(index), window);
      const counted = await getEventCount(database, localUser(index), window);

      expect(counted).toBe(listed.length);
    });
  }
});

describe("a window counted as empty", () => {
  for (const [index, shape] of SHAPES.entries()) {
    it(`is offered as free time only when nothing occupies it: ${shape.name}`, async () => {
      const window = readWindow(shape);
      const counted = await getEventCount(database, localUser(index), window);
      if (counted > 0) {
        return;
      }

      const freeTime = await findFreeTime(
        database,
        localUser(index),
        window,
        {
          durationMinutes: 15,
          ignoreAllDayEvents: false,
          limit: 50,
          timezone: "UTC",
          workingHours: null,
        },
      );
      const freeMinutes = freeTime.slots.reduce(
        (total, slot) => total + slot.durationMinutes,
        0,
      );
      const windowMinutes = (window.to.getTime() - window.from.getTime()) / 60_000;

      expect(freeMinutes).toBe(windowMinutes);
    });
  }
});
