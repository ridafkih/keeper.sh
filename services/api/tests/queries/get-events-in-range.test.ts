import { describe, expect, it } from "vitest";
import { flattenSyncedEvents } from "../../src/queries/get-events-in-range";

const sourceMap = new Map([
  [
    "calendar-1",
    {
      name: "Source",
      provider: "ics",
      url: null,
      userId: "user-1",
    },
  ],
]);

const rows = [
  {
    availability: "busy",
    calendarId: "calendar-1",
    description: null,
    endTime: new Date("2026-03-02T11:00:00.000Z"),
    exceptionDates: null,
    id: "master-1",
    isAllDay: false,
    location: null,
    recurrenceId: null,
    recurrenceRule: JSON.stringify({ count: 2, frequency: "WEEKLY" }),
    sourceEventUid: "series-1",
    startTime: new Date("2026-03-02T10:00:00.000Z"),
    startTimeZone: "Etc/UTC",
    title: "Master",
  },
  {
    availability: "free",
    calendarId: "calendar-1",
    description: null,
    endTime: new Date("2026-03-10T13:00:00.000Z"),
    exceptionDates: null,
    id: "override-1",
    isAllDay: true,
    location: null,
    recurrenceId: new Date("2026-03-09T10:00:00.000Z"),
    recurrenceRule: null,
    sourceEventUid: "series-1",
    startTime: new Date("2026-03-10T12:00:00.000Z"),
    startTimeZone: "Etc/UTC",
    title: "Override",
  },
];

const flatten = (filters?: { availability?: string[]; isAllDay?: boolean }) =>
  flattenSyncedEvents(
    rows,
    sourceMap,
    new Date("2026-03-01T00:00:00.000Z"),
    new Date("2026-03-31T23:59:59.999Z"),
    filters,
  );

describe("flattenSyncedEvents", () => {
  it("reconciles detached overrides before applying availability filters", () => {
    expect(flatten({ availability: ["busy"] }).map((event) => event.title)).toEqual(["Master"]);
    expect(flatten({ availability: ["free"] }).map((event) => event.title)).toEqual(["Override"]);
  });

  it("reconciles detached overrides before applying all-day filters", () => {
    expect(flatten({ isAllDay: false }).map((event) => event.title)).toEqual(["Master"]);
    expect(flatten({ isAllDay: true }).map((event) => event.title)).toEqual(["Override"]);
  });
});
