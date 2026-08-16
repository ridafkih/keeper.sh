import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSyncedRangeCondition } from "../../src/queries/get-events-in-range";
import { projectSyncedEvents } from "../../src/queries/event-read-model";
import type { SyncedEventRow } from "../../src/queries/event-read-model";

const CALENDAR_ID = "00000000-0000-4000-8000-0000000000ca";
const WINDOW_START = new Date("2027-03-08T00:00:00.000Z");
const WINDOW_END = new Date("2027-04-08T00:00:00.000Z");

const sourceMap = new Map([
  [CALENDAR_ID, { name: "Source", provider: "ics", url: null, userId: "user-1" }],
]);

interface Fixture {
  endTime: Date;
  id: string;
  label: string;
  startTime: Date;
}

const fixtures: Fixture[] = [
  {
    endTime: new Date("2027-03-05T16:00:00.000Z"),
    id: "00000000-0000-4000-8000-000000000001",
    label: "inverted range whose start sits inside the window",
    startTime: new Date("2027-03-20T16:00:00.000Z"),
  },
  {
    endTime: WINDOW_START,
    id: "00000000-0000-4000-8000-000000000002",
    label: "zero-duration range on the window's lower edge",
    startTime: WINDOW_START,
  },
  {
    endTime: new Date("2027-03-20T17:00:00.000Z"),
    id: "00000000-0000-4000-8000-000000000003",
    label: "ordinary range inside the window",
    startTime: new Date("2027-03-20T16:00:00.000Z"),
  },
  {
    endTime: new Date("2027-03-01T17:00:00.000Z"),
    id: "00000000-0000-4000-8000-000000000004",
    label: "ordinary range wholly before the window",
    startTime: new Date("2027-03-01T16:00:00.000Z"),
  },
];

const toRow = (fixture: Fixture): SyncedEventRow => ({
  availability: "busy",
  calendarId: CALENDAR_ID,
  description: null,
  endTime: fixture.endTime,
  exceptionDates: null,
  id: fixture.id,
  isAllDay: false,
  location: null,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: fixture.id,
  startTime: fixture.startTime,
  startTimeZone: null,
  title: fixture.label,
});

const database = new PGlite();

const readIdsAdmittedBySql = async (): Promise<Set<string>> => {
  const condition = buildSyncedRangeCondition(WINDOW_START, WINDOW_END);
  const query = new PgDialect().sqlToQuery(
    sql`select "id" from event_states where ${condition}`,
  );
  const result = await database.query<{ id: string }>(query.sql, query.params as never[]);
  return new Set(result.rows.map((row) => row.id));
};

const readIdsAdmittedInMemory = (): Set<string> => new Set(
  projectSyncedEvents(fixtures.map((fixture) => toRow(fixture)), sourceMap, WINDOW_START, WINDOW_END)
    .map((projection) => projection.eventStateId ?? ""),
);

beforeAll(async () => {
  await database.query(`create table event_states (
    "id" uuid primary key,
    "calendarId" uuid not null,
    "startTime" timestamptz not null,
    "endTime" timestamptz not null,
    "recurrenceRule" text,
    "recurrenceId" timestamptz
  )`);

  for (const fixture of fixtures) {
    await database.query(
      `insert into event_states ("id", "calendarId", "startTime", "endTime")
       values ($1, $2, $3, $4)`,
      [
        fixture.id,
        CALENDAR_ID,
        fixture.startTime.toISOString(),
        fixture.endTime.toISOString(),
      ],
    );
  }
});

afterAll(async () => {
  await database.close();
});

describe("the read API's synced-range prefilter", () => {
  it("admits every row the shared window predicate goes on to emit", async () => {
    const admittedBySql = await readIdsAdmittedBySql();
    const admittedInMemory = readIdsAdmittedInMemory();

    const droppedByTheScan = fixtures
      .filter((fixture) => admittedInMemory.has(fixture.id) && !admittedBySql.has(fixture.id))
      .map((fixture) => fixture.label);

    expect(droppedByTheScan).toEqual([]);
  });

  it("keeps the scan off rows no predicate could admit", async () => {
    const admittedBySql = await readIdsAdmittedBySql();

    expect(admittedBySql.has("00000000-0000-4000-8000-000000000004")).toBe(false);
    expect(admittedBySql.has("00000000-0000-4000-8000-000000000003")).toBe(true);
  });

  it("admits a zero-duration row sitting on the window's lower edge", async () => {
    const admittedBySql = await readIdsAdmittedBySql();

    expect(admittedBySql.has("00000000-0000-4000-8000-000000000002")).toBe(true);
  });
});
