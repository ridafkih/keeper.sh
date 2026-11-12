import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { getEventCount } from "../../src/queries/get-event-count";
import type { KeeperDatabase } from "../../src/types";

const DDL = `
create table calendar_accounts (
  "id" uuid primary key,
  "provider" text not null,
  "userId" text not null
);
create table calendars (
  "id" uuid primary key,
  "color" text,
  "accountId" uuid not null,
  "userId" text not null,
  "name" text not null,
  "url" text,
  "calendarType" text not null default 'source',
  "capabilities" text[] not null default '{"pull"}'
);
create table event_states (
  "id" uuid primary key,
  "color" text,
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

const USER_ID = "user-viewer-zone-count";
const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a3";
const CALENDAR_ID = "00000000-0000-4000-8000-0000000000c3";

const ALL_DAY_DATES = ["2026-11-11", "2026-11-12", "2026-11-13"];

const toUtcMidnight = (date: string): string => `${date}T00:00:00.000Z`;

const nextDay = (date: string): string =>
  new Date(Date.parse(toUtcMidnight(date)) + 24 * 60 * 60 * 1000).toISOString();

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
  for (const [index, date] of ALL_DAY_DATES.entries()) {
    await client.query(
      `insert into event_states (
        "id", "calendarId", "availability", "endTime", "isAllDay",
        "sourceEventUid", "startTime", "title"
      ) values ($1, $2, 'busy', $3, true, $4, $5, $6)`,
      [
        `00000000-0000-4000-8000-0000000001e${index}`,
        CALENDAR_ID,
        nextDay(date),
        `synced-${date}`,
        toUtcMidnight(date),
        `Synced ${date}`,
      ],
    );
  }
});

describe("event counts in a viewer-zone day window", () => {
  it("counts only Thursday's all-day event in a Chicago Thursday", async () => {
    expect(await getEventCount(database, USER_ID, {
      from: new Date("2026-11-12T06:00:00.000Z"),
      timeZone: "America/Chicago",
      to: new Date("2026-11-13T05:59:59.999Z"),
    })).toBe(1);
  });

  it("counts only Thursday's all-day event in an Auckland Thursday", async () => {
    expect(await getEventCount(database, USER_ID, {
      from: new Date("2026-11-11T11:00:00.000Z"),
      timeZone: "Pacific/Auckland",
      to: new Date("2026-11-12T10:59:59.999Z"),
    })).toBe(1);
  });
});
