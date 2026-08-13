import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventsInRange } from "../../src/queries/get-events-in-range";
import type { KeeperDatabase } from "../../src/types";

const WINDOW_START = "2027-05-10T09:00:00.000Z";
const WINDOW_END = "2027-05-10T17:00:00.000Z";

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
}

const SHAPES: Shape[] = [
  {
    endTime: WINDOW_START,
    isAllDay: false,
    name: "ends exactly at the window start",
    startTime: "2027-05-10T08:00:00.000Z",
  },
  {
    endTime: "2027-05-10T18:00:00.000Z",
    isAllDay: false,
    name: "starts exactly at the window end",
    startTime: WINDOW_END,
  },
  {
    endTime: WINDOW_START,
    isAllDay: false,
    name: "is a point at the window start",
    startTime: WINDOW_START,
  },
  {
    endTime: WINDOW_END,
    isAllDay: false,
    name: "is a point at the window end",
    startTime: WINDOW_END,
  },
  {
    endTime: "2027-05-10T08:00:00.000Z",
    isAllDay: false,
    name: "is inverted with its start inside the window",
    startTime: "2027-05-10T12:00:00.000Z",
  },
  {
    endTime: "2027-05-09T23:00:00.000Z",
    isAllDay: false,
    name: "is inverted with its start at the window end",
    startTime: WINDOW_END,
  },
  {
    endTime: "2027-05-10T20:00:00.000Z",
    isAllDay: true,
    name: "is an all-day range off the UTC day grid",
    startTime: "2027-05-10T04:00:00.000Z",
  },
  {
    endTime: "2027-05-10T03:00:00.000Z",
    isAllDay: true,
    name: "is an all-day range that ends before the window opens",
    startTime: "2027-05-10T01:00:00.000Z",
  },
];

const pad = (value: number): string => value.toString().padStart(2, "0");

const seed = async (shape: Shape, index: number): Promise<void> => {
  const userId = `user-agreement-${index}`;
  const accountId = `00000000-0000-4000-8000-0000000c00${pad(index)}`;
  const calendarId = `00000000-0000-4000-8000-0000000d00${pad(index)}`;
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, $2, $3)`,
    [accountId, "google", userId],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name", "url") values ($1, $2, $3, $4, $5)`,
    [calendarId, accountId, userId, "Personal", null],
  );
  await client.query(
    `insert into event_states ("id", "calendarId", "title", "availability", "isAllDay", "startTime", "endTime", "sourceEventUid")
     values ($1, $2, 'synced', 'busy', $3, $4, $5, $6)`,
    [
      `00000000-0000-4000-8000-0000000e00${pad(index)}`,
      calendarId,
      shape.isAllDay,
      shape.startTime,
      shape.endTime,
      `synced-${index}`,
    ],
  );
  await client.query(
    `insert into user_events ("id", "calendarId", "userId", "title", "availability", "isAllDay", "startTime", "endTime")
     values ($1, $2, $3, 'local', 'busy', $4, $5, $6)`,
    [
      `00000000-0000-4000-8000-0000000f00${pad(index)}`,
      calendarId,
      userId,
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

describe("a synced row and a local row carrying the same range", () => {
  for (const [index, shape] of SHAPES.entries()) {
    it(`are admitted together by a window when the range ${shape.name}`, async () => {
      const events = await getEventsInRange(
        database,
        `user-agreement-${index}`,
        { from: new Date(WINDOW_START), to: new Date(WINDOW_END) },
      );
      const titles = new Set(events.map((event) => event.title));

      expect(titles.has("synced")).toBe(titles.has("local"));
    });

    it(`publish the same span when the range ${shape.name}`, async () => {
      const events = await getEventsInRange(
        database,
        `user-agreement-${index}`,
        { from: new Date("2027-05-01T00:00:00.000Z"), to: new Date("2027-05-20T00:00:00.000Z") },
      );
      const synced = events.find((event) => event.title === "synced");
      const local = events.find((event) => event.title === "local");

      expect({ end: local?.endTime, start: local?.startTime })
        .toEqual({ end: synced?.endTime, start: synced?.startTime });
    });
  }
});
