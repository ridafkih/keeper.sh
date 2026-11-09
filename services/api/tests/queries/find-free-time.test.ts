import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  findFreeTime,
  isBlocking,
  projectAllDaySpanToZone,
  toBusyInterval,
  toBusyIntervals,
} from "../../src/queries/find-free-time";
import { findFreeSlots } from "../../src/utils/free-time";
import type { FreeTimeOptions, TimeInterval, WorkingHours } from "../../src/utils/free-time";
import type { KeeperDatabase } from "../../src/types";

const candidate = (overrides: {
  availability?: string | null;
  isAllDay?: boolean | null;
}) => ({
  endTime: new Date("2026-03-02T10:00:00Z"),
  startTime: new Date("2026-03-02T09:00:00Z"),
  ...overrides,
});

describe("isBlocking", () => {
  it("treats busy events as blocking", () => {
    expect(isBlocking(candidate({ availability: "busy" }), false)).toBe(true);
  });

  it("treats out-of-office events as blocking", () => {
    expect(isBlocking(candidate({ availability: "oof" }), false)).toBe(true);
  });

  it("treats free events as non-blocking", () => {
    expect(isBlocking(candidate({ availability: "free" }), false)).toBe(false);
  });

  it("treats working-elsewhere events as non-blocking", () => {
    expect(isBlocking(candidate({ availability: "workingElsewhere" }), false)).toBe(false);
  });

  it("treats an unknown availability as blocking", () => {
    expect(isBlocking(candidate({ availability: null }), false)).toBe(true);
    expect(isBlocking(candidate({}), false)).toBe(true);
  });

  it("blocks all-day busy events by default", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: true }), false)).toBe(true);
  });

  it("ignores all-day events when asked to", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: true }), true)).toBe(false);
  });

  it("still blocks timed events when all-day events are ignored", () => {
    expect(isBlocking(candidate({ availability: "busy", isAllDay: false }), true)).toBe(true);
  });

  it("keeps free all-day events non-blocking either way", () => {
    expect(isBlocking(candidate({ availability: "free", isAllDay: true }), false)).toBe(false);
  });
});

const span = (start: string, end: string): TimeInterval => ({
  end: new Date(end),
  start: new Date(start),
});

const toIso = ({ end, start }: TimeInterval) => ({
  end: end.toISOString(),
  start: start.toISOString(),
});

const allDay = (startDate: string, endDate: string) => ({
  availability: "busy",
  endTime: new Date(`${endDate}T00:00:00.000Z`),
  isAllDay: true,
  startTime: new Date(`${startDate}T00:00:00.000Z`),
});

const timed = (start: string, end: string) => ({
  availability: "busy",
  endTime: new Date(end),
  isAllDay: false,
  startTime: new Date(start),
});

const NINE_TO_FIVE: WorkingHours = { days: null, endMinute: 17 * 60, startMinute: 9 * 60 };

const slotOptions = (
  timezone: string,
  workingHours: WorkingHours | null,
): FreeTimeOptions => ({ durationMinutes: 30, limit: 50, timezone, workingHours });

const freeSlotsAround = (
  candidates: ReturnType<typeof allDay>[],
  range: TimeInterval,
  timezone: string,
  workingHours: WorkingHours | null,
) => findFreeSlots(
  range,
  toBusyIntervals(candidates, range, timezone, false),
  slotOptions(timezone, workingHours),
).map(({ end, start }) => ({ end, start }));

describe("projectAllDaySpanToZone", () => {
  it("maps an Auckland Thursday to its local midnights", () => {
    expect(toIso(projectAllDaySpanToZone(
      span("2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z"),
      "Pacific/Auckland",
    ))).toEqual({ end: "2026-11-05T11:00:00.000Z", start: "2026-11-04T11:00:00.000Z" });
  });

  it("maps a Los Angeles Thursday to its local midnights", () => {
    expect(toIso(projectAllDaySpanToZone(
      span("2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z"),
      "America/Los_Angeles",
    ))).toEqual({ end: "2026-11-06T08:00:00.000Z", start: "2026-11-05T08:00:00.000Z" });
  });

  it("starts a day whose midnight falls in a daylight-saving gap at its first instant", () => {
    expect(toIso(projectAllDaySpanToZone(
      span("2026-09-06T00:00:00.000Z", "2026-09-07T00:00:00.000Z"),
      "America/Santiago",
    ))).toEqual({ end: "2026-09-07T03:00:00.000Z", start: "2026-09-06T04:00:00.000Z" });
  });

  it("leaves UTC days where they are", () => {
    expect(toIso(projectAllDaySpanToZone(
      span("2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z"),
      "UTC",
    ))).toEqual({ end: "2026-11-06T00:00:00.000Z", start: "2026-11-05T00:00:00.000Z" });
  });
});

describe("toBusyInterval in the requested zone", () => {
  const wideRange = span("2026-08-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z");

  it("blocks the whole local day of an all-day event", () => {
    expect(toIso(toBusyInterval(allDay("2026-11-05", "2026-11-06"), wideRange, "Pacific/Auckland")))
      .toEqual({ end: "2026-11-05T11:00:00.000Z", start: "2026-11-04T11:00:00.000Z" });
  });

  it("blocks the whole local day of a degenerate all-day event", () => {
    expect(toIso(toBusyInterval(allDay("2026-11-05", "2026-11-05"), wideRange, "America/Los_Angeles")))
      .toEqual({ end: "2026-11-06T08:00:00.000Z", start: "2026-11-05T08:00:00.000Z" });
  });

  it("keeps a timed event at its own instants", () => {
    expect(toIso(toBusyInterval(
      timed("2026-11-05T20:00:00.000Z", "2026-11-05T21:30:00.000Z"),
      wideRange,
      "Pacific/Auckland",
    ))).toEqual({ end: "2026-11-05T21:30:00.000Z", start: "2026-11-05T20:00:00.000Z" });
  });

  it("clips the projected day to the range", () => {
    expect(toIso(toBusyInterval(
      allDay("2026-11-05", "2026-11-06"),
      span("2026-11-06T00:00:00.000Z", "2026-11-06T01:00:00.000Z"),
      "America/Los_Angeles",
    ))).toEqual({ end: "2026-11-06T01:00:00.000Z", start: "2026-11-06T00:00:00.000Z" });
  });
});

describe("toBusyIntervals", () => {
  const range = span("2026-11-04T11:00:00.000Z", "2026-11-06T11:00:00.000Z");

  it("drops all-day events when asked to ignore them", () => {
    expect(toBusyIntervals([allDay("2026-11-05", "2026-11-06")], range, "Pacific/Auckland", true))
      .toEqual([]);
  });

  it("drops non-blocking events", () => {
    expect(toBusyIntervals(
      [{ ...allDay("2026-11-05", "2026-11-06"), availability: "free" }],
      range,
      "Pacific/Auckland",
      false,
    )).toEqual([]);
  });

  it("drops events left empty by the clip", () => {
    expect(toBusyIntervals(
      [timed("2026-11-07T01:00:00.000Z", "2026-11-07T02:00:00.000Z")],
      range,
      "Pacific/Auckland",
      false,
    )).toEqual([]);
  });

  it("keeps ignored-all-day requests blocking on timed events", () => {
    expect(toBusyIntervals(
      [timed("2026-11-05T20:00:00.000Z", "2026-11-05T21:00:00.000Z")],
      range,
      "Pacific/Auckland",
      true,
    ).map((interval) => toIso(interval)))
      .toEqual([{ end: "2026-11-05T21:00:00.000Z", start: "2026-11-05T20:00:00.000Z" }]);
  });
});

describe("free slots around all-day events in the requested zone", () => {
  it("keeps an Auckland Thursday busy and frees Friday from 09:00", () => {
    expect(freeSlotsAround(
      [allDay("2026-11-05", "2026-11-06")],
      span("2026-11-04T11:00:00.000Z", "2026-11-06T11:00:00.000Z"),
      "Pacific/Auckland",
      NINE_TO_FIVE,
    )).toEqual([{ end: "2026-11-06T04:00:00.000Z", start: "2026-11-05T20:00:00.000Z" }]);
  });

  it("keeps a Kiritimati Thursday busy and frees Friday from 09:00", () => {
    expect(freeSlotsAround(
      [allDay("2026-11-05", "2026-11-06")],
      span("2026-11-04T10:00:00.000Z", "2026-11-06T10:00:00.000Z"),
      "Pacific/Kiritimati",
      NINE_TO_FIVE,
    )).toEqual([{ end: "2026-11-06T03:00:00.000Z", start: "2026-11-05T19:00:00.000Z" }]);
  });

  it("keeps a Pago Pago Thursday busy and frees Wednesday and Friday", () => {
    expect(freeSlotsAround(
      [allDay("2026-11-05", "2026-11-06")],
      span("2026-11-04T11:00:00.000Z", "2026-11-07T11:00:00.000Z"),
      "Pacific/Pago_Pago",
      NINE_TO_FIVE,
    )).toEqual([
      { end: "2026-11-05T04:00:00.000Z", start: "2026-11-04T20:00:00.000Z" },
      { end: "2026-11-07T04:00:00.000Z", start: "2026-11-06T20:00:00.000Z" },
    ]);
  });

  it("keeps Los Angeles Thursday 16:00 busy and frees Wednesday 16:00", () => {
    expect(freeSlotsAround(
      [allDay("2026-11-05", "2026-11-06")],
      span("2026-11-05T00:00:00.000Z", "2026-11-06T01:00:00.000Z"),
      "America/Los_Angeles",
      { days: null, endMinute: 17 * 60, startMinute: 16 * 60 },
    )).toEqual([{ end: "2026-11-05T01:00:00.000Z", start: "2026-11-05T00:00:00.000Z" }]);
  });

  it("blocks every Los Angeles day of a multi-day event across the fall-back", () => {
    expect(freeSlotsAround(
      [allDay("2026-10-31", "2026-11-03")],
      span("2026-10-30T07:00:00.000Z", "2026-11-04T08:00:00.000Z"),
      "America/Los_Angeles",
      null,
    )).toEqual([
      { end: "2026-10-31T07:00:00.000Z", start: "2026-10-30T07:00:00.000Z" },
      { end: "2026-11-04T08:00:00.000Z", start: "2026-11-03T08:00:00.000Z" },
    ]);
  });

  it("frees the Los Angeles working days either side of a multi-day event", () => {
    expect(freeSlotsAround(
      [allDay("2026-10-31", "2026-11-03")],
      span("2026-10-30T07:00:00.000Z", "2026-11-04T08:00:00.000Z"),
      "America/Los_Angeles",
      NINE_TO_FIVE,
    )).toEqual([
      { end: "2026-10-31T00:00:00.000Z", start: "2026-10-30T16:00:00.000Z" },
      { end: "2026-11-04T01:00:00.000Z", start: "2026-11-03T17:00:00.000Z" },
    ]);
  });

  it("spans 73 hours for three Los Angeles days that gain an hour", () => {
    expect(toBusyIntervals(
      [allDay("2026-10-31", "2026-11-03")],
      span("2026-10-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"),
      "America/Los_Angeles",
      false,
    ).map((interval) => toIso(interval))).toEqual([{
      end: "2026-11-03T08:00:00.000Z",
      start: "2026-10-31T07:00:00.000Z",
    }]);
  });

  it("blocks every Auckland day of a multi-day event across the spring-forward", () => {
    expect(freeSlotsAround(
      [allDay("2026-09-26", "2026-09-29")],
      span("2026-09-24T12:00:00.000Z", "2026-09-29T11:00:00.000Z"),
      "Pacific/Auckland",
      null,
    )).toEqual([
      { end: "2026-09-25T12:00:00.000Z", start: "2026-09-24T12:00:00.000Z" },
      { end: "2026-09-29T11:00:00.000Z", start: "2026-09-28T11:00:00.000Z" },
    ]);
  });

  it("blocks a Santiago day that starts at 01:00 and nothing either side", () => {
    expect(freeSlotsAround(
      [allDay("2026-09-06", "2026-09-07")],
      span("2026-09-05T04:00:00.000Z", "2026-09-08T03:00:00.000Z"),
      "America/Santiago",
      null,
    )).toEqual([
      { end: "2026-09-06T04:00:00.000Z", start: "2026-09-05T04:00:00.000Z" },
      { end: "2026-09-08T03:00:00.000Z", start: "2026-09-07T03:00:00.000Z" },
    ]);
  });

  it("answers as before for a UTC request", () => {
    expect(freeSlotsAround(
      [allDay("2026-11-05", "2026-11-06")],
      span("2026-11-04T00:00:00.000Z", "2026-11-07T00:00:00.000Z"),
      "UTC",
      null,
    )).toEqual([
      { end: "2026-11-05T00:00:00.000Z", start: "2026-11-04T00:00:00.000Z" },
      { end: "2026-11-07T00:00:00.000Z", start: "2026-11-06T00:00:00.000Z" },
    ]);
  });
});

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

const SYNCED_ONE_OFF_USER = "user-free-time-synced-one-off";
const SYNCED_SERIES_USER = "user-free-time-synced-series";
const USER_EVENT_USER = "user-free-time-user-event";

const seedUser = async (userId: string, index: number): Promise<string> => {
  const accountId = `00000000-0000-4000-8000-00000000a00${index}`;
  const calendarId = `00000000-0000-4000-8000-00000000c00${index}`;
  await client.query(
    `insert into calendar_accounts ("id", "provider", "userId") values ($1, 'google', $2)`,
    [accountId, userId],
  );
  await client.query(
    `insert into calendars ("id", "accountId", "userId", "name") values ($1, $2, $3, 'Primary')`,
    [calendarId, accountId, userId],
  );
  return calendarId;
};

const seedSyncedAllDay = async (
  calendarId: string,
  eventId: string,
  startDate: string,
  endDate: string,
  recurrenceRule: string | null,
) => {
  await client.query(
    `insert into event_states (
      "id", "calendarId", "availability", "endTime", "isAllDay", "recurrenceRule",
      "sourceEventUid", "startTime", "title"
    ) values ($1, $2, 'busy', $3, true, $4, $5, $6, 'All day')`,
    [
      eventId,
      calendarId,
      `${endDate}T00:00:00.000Z`,
      recurrenceRule,
      `${eventId}@google.com`,
      `${startDate}T00:00:00.000Z`,
    ],
  );
};

beforeAll(async () => {
  await client.exec(DDL);

  const oneOffCalendar = await seedUser(SYNCED_ONE_OFF_USER, 1);
  await seedSyncedAllDay(
    oneOffCalendar,
    "00000000-0000-4000-8000-00000000e001",
    "2026-11-05",
    "2026-11-06",
    null,
  );

  const seriesCalendar = await seedUser(SYNCED_SERIES_USER, 2);
  await seedSyncedAllDay(
    seriesCalendar,
    "00000000-0000-4000-8000-00000000e002",
    "2026-10-30",
    "2026-10-31",
    JSON.stringify({ count: 4, frequency: "WEEKLY" }),
  );

  const userEventCalendar = await seedUser(USER_EVENT_USER, 3);
  await client.query(
    `insert into user_events (
      "id", "calendarId", "userId", "availability", "isAllDay", "startTime", "endTime", "title"
    ) values ($1, $2, $3, 'busy', true, $4, $5, 'All day')`,
    [
      "00000000-0000-4000-8000-00000000f003",
      userEventCalendar,
      USER_EVENT_USER,
      "2026-11-05T00:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
    ],
  );
});

const freeSlotsFor = async (
  userId: string,
  from: string,
  to: string,
  timezone: string,
  workingHours: WorkingHours | null,
) => {
  const { slots } = await findFreeTime(
    database,
    userId,
    { from: new Date(from), to: new Date(to) },
    { durationMinutes: 30, ignoreAllDayEvents: false, limit: 50, timezone, workingHours },
  );
  return slots.map(({ end, start }) => ({ end, start }));
};

describe("findFreeTime with all-day events in the requested zone", () => {
  it("keeps Los Angeles Thursday 16:00-17:00 busy for a synced all-day event", async () => {
    expect(await freeSlotsFor(
      SYNCED_ONE_OFF_USER,
      "2026-11-06T00:00:00.000Z",
      "2026-11-06T01:00:00.000Z",
      "America/Los_Angeles",
      null,
    )).toEqual([]);
  });

  it("frees Los Angeles Wednesday 16:00-17:00 before a synced all-day Thursday", async () => {
    expect(await freeSlotsFor(
      SYNCED_ONE_OFF_USER,
      "2026-11-05T00:00:00.000Z",
      "2026-11-05T01:00:00.000Z",
      "America/Los_Angeles",
      null,
    )).toEqual([{ end: "2026-11-05T01:00:00.000Z", start: "2026-11-05T00:00:00.000Z" }]);
  });

  it("keeps an Auckland Thursday busy and frees Friday morning for a synced all-day event", async () => {
    expect(await freeSlotsFor(
      SYNCED_ONE_OFF_USER,
      "2026-11-04T11:00:00.000Z",
      "2026-11-06T11:00:00.000Z",
      "Pacific/Auckland",
      NINE_TO_FIVE,
    )).toEqual([{ end: "2026-11-06T04:00:00.000Z", start: "2026-11-05T20:00:00.000Z" }]);
  });

  it("blocks Auckland Friday 09:00 for a weekly all-day series that starts later in UTC", async () => {
    expect(await freeSlotsFor(
      SYNCED_SERIES_USER,
      "2026-11-05T20:00:00.000Z",
      "2026-11-05T21:00:00.000Z",
      "Pacific/Auckland",
      null,
    )).toEqual([]);
  });

  it("frees Auckland Saturday 09:00 after a weekly all-day Friday", async () => {
    expect(await freeSlotsFor(
      SYNCED_SERIES_USER,
      "2026-11-06T20:00:00.000Z",
      "2026-11-06T21:00:00.000Z",
      "Pacific/Auckland",
      null,
    )).toEqual([{ end: "2026-11-06T21:00:00.000Z", start: "2026-11-06T20:00:00.000Z" }]);
  });

  it("keeps Los Angeles Thursday 16:00-17:00 busy for a user-created all-day event", async () => {
    expect(await freeSlotsFor(
      USER_EVENT_USER,
      "2026-11-06T00:00:00.000Z",
      "2026-11-06T01:00:00.000Z",
      "America/Los_Angeles",
      null,
    )).toEqual([]);
  });

  it("keeps Auckland Thursday 09:00 busy for a user-created all-day event that starts later in UTC", async () => {
    expect(await freeSlotsFor(
      USER_EVENT_USER,
      "2026-11-04T20:00:00.000Z",
      "2026-11-04T21:00:00.000Z",
      "Pacific/Auckland",
      null,
    )).toEqual([]);
  });

  it("rejects an unknown zone before reading events", async () => {
    await expect(freeSlotsFor(
      SYNCED_ONE_OFF_USER,
      "2026-11-05T00:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
      "Not/AZone",
      null,
    )).rejects.toThrow("timezone must be an IANA timezone identifier");
  });
});
